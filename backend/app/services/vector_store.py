import chromadb
from typing import List, Dict, Any
import uuid
import os
import re
import logging
import time

logger = logging.getLogger(__name__)

# Minimum cosine similarity threshold (text2vec produces values 0~1)
MIN_SCORE = 0.35

CHROMA_DIR = os.getenv("CHROMA_DIR", os.path.join(os.path.dirname(__file__), "..", "..", "chroma_db"))


class Text2VecEmbeddingFunction:
    """Chinese-optimized embedding using text2vec (shibing624/text2vec-base-chinese)."""

    def __init__(self):
        self._model = None

    def _get_model(self):
        if self._model is None:
            try:
                from text2vec import SentenceModel
                self._model = SentenceModel("shibing624/text2vec-base-chinese")
                logger.info("text2vec model loaded successfully")
            except Exception as e:
                logger.error(f"Failed to load text2vec model: {e}")
                raise
        return self._model

    def preload(self):
        """Pre-load the model to avoid latency on first request."""
        self._get_model()

    def encode_batch(self, texts: list) -> list:
        """Encode a batch of texts in one call (much faster than per-chunk)."""
        model = self._get_model()
        embeddings = model.encode(texts, show_progress_bar=False, batch_size=32)
        return embeddings.tolist()

    def __call__(self, input: list) -> list:
        model = self._get_model()
        embeddings = model.encode(input)
        return embeddings.tolist()

    def embed_documents(self, input: list) -> list:
        return self(input)

    def embed_query(self, input: list) -> list:
        return self(input)

    def name(self) -> str:
        return "text2vec-chinese"


class VectorStoreService:
    def __init__(self):
        os.makedirs(CHROMA_DIR, exist_ok=True)
        self.embedding_fn = Text2VecEmbeddingFunction()
        self.client = chromadb.PersistentClient(path=CHROMA_DIR)

    def _get_user_collection(self, user_id: str, doc_type: str):
        name = f"{doc_type}_{user_id}"
        return self.client.get_or_create_collection(
            name=name,
            metadata={"hnsw:space": "cosine"},
            embedding_function=self.embedding_fn,
        )

    def add_document(self, user_id: str, doc_type: str, content: str, filename: str, source_url: str = "") -> str:
        collection = self._get_user_collection(user_id, doc_type)

        # Prevent duplicate: if same filename exists, delete old version first
        if filename:
            self._delete_by_filename(collection, user_id, filename)

        doc_id = str(uuid.uuid4())
        chunk_size = 400 if doc_type == "style" else 600
        chunks = self._split_text(content, chunk_size=chunk_size)

        chunk_ids = [f"{doc_id}_chunk_{i}" for i in range(len(chunks))]
        metadatas = [{
            "filename": filename,
            "doc_id": doc_id,
            "chunk_index": i,
            "user_id": user_id,
            "source_url": source_url,
            "created_at": str(int(time.time() * 1000)) if i == 0 else "",
            "content_size": str(len(content)) if i == 0 else "",
            "content_preview": content[:2000] if i == 0 else "",
            "full_content": content if i == 0 else "",
        } for i in range(len(chunks))]

        embeddings = self.embedding_fn.encode_batch(chunks)
        collection.add(
            ids=chunk_ids,
            documents=chunks,
            metadatas=metadatas,
            embeddings=embeddings,
        )
        return doc_id

    def _delete_by_filename(self, collection, user_id: str, filename: str):
        """Delete all chunks with matching filename."""
        try:
            results = collection.get(where={"filename": filename})
            if results["ids"]:
                collection.delete(ids=results["ids"])
        except Exception:
            pass

    def rename_document(self, user_id: str, doc_type: str, doc_id: str, new_filename: str) -> bool:
        """Rename a document's filename in metadata."""
        collection = self._get_user_collection(user_id, doc_type)
        try:
            results = collection.get(where={"doc_id": doc_id})
            if not results["metadatas"]:
                return False
            # Update each chunk's metadata
            for i, meta in enumerate(results["metadatas"]):
                meta["filename"] = new_filename
            collection.update(
                ids=results["ids"],
                metadatas=results["metadatas"],
            )
            return True
        except Exception as e:
            logger.warning(f"Rename failed: {e}")
            return False

    def search(self, user_id, doc_type, query, k=3):
        collection = self._get_user_collection(user_id, doc_type)
        try:
            results = collection.get()
            if not results["documents"]:
                return []

            # --- 1. Split long queries into segments ---
            segments = self._split_query(query)
            all_docs = results["documents"]
            all_metas = results["metadatas"]
            all_ids = results["ids"]

            # --- 2. Vector search: query each segment, merge & deduplicate ---
            seen_ids = set()
            scored_results = []  # (doc_id, chunk_index, score, content, metadata)

            for seg in segments:
                truncated = seg[:400]
                try:
                    qres = collection.query(query_texts=[truncated], n_results=min(k * 3, len(all_docs)))
                    if qres["documents"] and qres["documents"][0]:
                        for doc, meta in zip(qres["documents"][0], qres["metadatas"][0]):
                            cid = meta.get("doc_id", "") + "_" + str(meta.get("chunk_index", 0))
                            if cid not in seen_ids:
                                seen_ids.add(cid)
                                scored_results.append((meta.get("doc_id"), meta.get("chunk_index", 0), 0.0, doc, meta))
                except Exception:
                    continue

            # --- 3. Keyword boost: extract key terms, boost matching chunks ---
            keywords = self._extract_keywords(query)
            if keywords:
                for i, (doc_id, chunk_idx, score, content, meta) in enumerate(scored_results):
                    text_lower = content.lower()
                    keyword_hits = sum(1 for kw in keywords if kw.lower() in text_lower)
                    if keyword_hits > 0:
                        # Boost score based on keyword match count
                        scored_results[i] = (doc_id, chunk_idx, keyword_hits * 0.1, content, meta)

            # --- 4. Score threshold filter ---
            filtered = [
                (doc_id, chunk_idx, boost, content, meta)
                for doc_id, chunk_idx, boost, content, meta in scored_results
                if boost >= 0 or self._has_keyword_match(content, keywords)
            ]

            # If nothing passes threshold, fall back to vector results without threshold
            if not filtered:
                filtered = scored_results

            # --- 5. Rank: sort by keyword boost desc, then take top k ---
            filtered.sort(key=lambda x: x[2], reverse=True)

            # Group by doc_id and keep best chunks per document
            doc_best = {}
            for doc_id, chunk_idx, boost, content, meta in filtered:
                if doc_id not in doc_best:
                    doc_best[doc_id] = []
                doc_best[doc_id].append((chunk_idx, boost, content, meta))

            # Interleave results from different documents for diversity
            final = []
            doc_ids_list = list(doc_best.keys())
            round_idx = 0
            while len(final) < k and round_idx < 100:
                for did in doc_ids_list:
                    chunks = doc_best[did]
                    if round_idx < len(chunks):
                        chunk_idx, boost, content, meta = chunks[round_idx]
                        final.append({"content": content, "metadata": meta})
                        if len(final) >= k:
                            break
                round_idx += 1

            return final

        except Exception as e:
            logger.warning(f"Hybrid search error: {e}")
            return []

    def _split_query(self, query: str) -> List[str]:
        """Split long query into overlapping segments for multi-query retrieval."""
        max_single = 400
        if len(query) <= max_single:
            return [query]

        # Split by paragraphs first, then by sentences if needed
        paragraphs = [p.strip() for p in query.split("\n\n") if p.strip()]
        segments = []
        current = ""

        for para in paragraphs:
            if len(current) + len(para) + 2 <= max_single:
                current += para + "\n\n"
            else:
                if current:
                    segments.append(current.strip())
                # If single paragraph is too long, split by sentence
                if len(para) > max_single:
                    sentences = re.split(r'([。！？.!?])', para)
                    buf = ""
                    for i in range(0, len(sentences), 2):
                        sent = sentences[i]
                        punct = sentences[i + 1] if i + 1 < len(sentences) else ""
                        piece = sent + punct
                        if len(buf) + len(piece) <= max_single:
                            buf += piece
                        else:
                            if buf:
                                segments.append(buf.strip())
                            buf = piece
                    if buf:
                        current = buf
                    else:
                        current = ""
                else:
                    current = para + "\n\n"

        if current.strip():
            segments.append(current.strip())

        # Add overlap: duplicate last 100 chars of each segment at the start of next
        if len(segments) > 1:
            overlapped = [segments[0]]
            for i in range(1, len(segments)):
                overlap = segments[i - 1][-100:]
                overlapped.append(overlap + " " + segments[i])
            return overlapped

        return segments if segments else [query[:max_single]]

    def _extract_keywords(self, text: str) -> List[str]:
        """Extract meaningful keywords from text for hybrid matching.

        Also expands keywords with bilingual equivalents (zh↔en) so that
        Chinese queries can match English knowledge base chunks and vice versa.
        """
        # Remove common stop words, keep nouns/terms (heuristic)
        stop_words = {
            '的', '了', '是', '在', '我', '有', '和', '就', '不', '人', '都', '一',
            '一个', '上', '也', '很', '到', '说', '要', '去', '你', '会', '着',
            '没有', '看', '好', '自己', '这', '他', '她', '它', '们', '那', '被',
            '从', '把', '让', '用', '为', '什么', '怎么', '如何', '可以', '如果',
            '吗', '呢', '吧', '啊', '呀', '哦', '嗯', '请', '问', '想', '能',
            'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
            'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
            'should', 'may', 'might', 'can', 'shall', 'to', 'of', 'in', 'for',
            'on', 'with', 'at', 'by', 'from', 'as', 'into', 'about', 'this',
            'that', 'it', 'its', 'i', 'you', 'he', 'she', 'we', 'they', 'me',
            'him', 'her', 'us', 'them', 'my', 'your', 'his', 'our', 'their',
            'and', 'or', 'but', 'not', 'no', 'if', 'then', 'so', 'very',
            'please', 'thank', 'thanks', 'dear', 'hi', 'hello', 'hey',
        }

        # Try jieba for Chinese segmentation if available
        words = []
        has_jieba = False
        try:
            import jieba
            has_jieba = True
        except ImportError:
            pass

        if has_jieba:
            # Use jieba for proper Chinese word segmentation
            seg_list = jieba.lcut(text)
            for w in seg_list:
                w = w.strip()
                if not w:
                    continue
                # Keep Chinese words (2+ chars) and English words (3+ chars)
                if re.match(r'^[一-鿿]{2,}$', w):
                    words.append(w.lower())
                elif re.match(r'^[a-zA-Z]{3,}$', w):
                    words.append(w.lower())
        else:
            # Fallback: split Chinese on particles, then extract
            # Split on common Chinese particles/punctuation
            chinese_parts = re.split(r'[，。！？、；：\s,.!?;:]+', text)
            for part in chinese_parts:
                part = part.strip()
                if not part:
                    continue
                # Split on common function words
                segments = re.split(r'[的了是在我有和就不人都一个上也很到说要去你会着没看好自己这他她它们那被从把让用为什么怎么如何可以如果吗呢吧啊呀哦嗯请问想能]', part)
                for seg in segments:
                    seg = seg.strip()
                    if re.match(r'^[一-鿿]{2,}$', seg) and len(seg) >= 2:
                        words.append(seg.lower())
            # Also extract English words
            for w in re.findall(r'[a-zA-Z]{3,}', text):
                words.append(w.lower())

        # Count frequency
        freq = {}
        for w in words:
            if w not in stop_words and len(w) >= 2:
                freq[w] = freq.get(w, 0) + 1

        # Return top keywords by frequency, expanded with bilingual equivalents
        raw = sorted(freq.keys(), key=lambda x: freq[x], reverse=True)[:10]
        expanded = []
        for kw in raw:
            expanded.append(kw)
            equivs = self._bilingual_expand(kw)
            expanded.extend(equivs)
        # Deduplicate while preserving order
        seen = set()
        result = []
        for kw in expanded:
            if kw not in seen:
                seen.add(kw)
                result.append(kw)
        return result[:20]  # Allow up to 20 after expansion

    # Bilingual keyword expansion dictionary (common terms in email/business contexts)
    _BILINGUAL_DICT = {
        # 时间相关
        '营业时间': ['opening hours', 'business hours', 'trading hours'],
        '开门': ['opening', 'open'],
        '关门': ['closing', 'close', 'closing time'],
        '营业': ['open', 'trading', 'business'],
        '时间': ['hours', 'time', 'schedule'],
        '周末': ['weekend', 'weekends'],
        '工作日': ['weekday', 'weekdays'],
        '节假日': ['public holiday', 'holidays'],
        '限制': ['restriction', 'restricted', 'limit'],
        '限时': ['time limit', 'before', 'after'],
        # 价格相关
        '价格': ['price', 'prices', 'cost'],
        '最低': ['minimum', 'min'],
        '订单': ['order'],
        '最低订单': ['minimum order'],
        '最低消费': ['minimum spend', 'minimum spend'],
        '优惠': ['discount', 'promotion', 'deal'],
        '折扣': ['discount'],
        '套餐': ['set menu', 'combo', 'package'],
        # 食物相关
        '菜单': ['menu'],
        '甜品': ['dessert', 'desserts'],
        '主食': ['main', 'mains', 'main course'],
        '饮品': ['drink', 'drinks', 'beverage', 'beverages'],
        '海鲜': ['seafood'],
        '点心': ['dim sum', 'snack', 'snacks'],
        '饺子': ['dumpling', 'dumplings'],
        '面条': ['noodle', 'noodles'],
        '米饭': ['rice'],
        '汤': ['soup'],
        '沙拉': ['salad'],
        '烧烤': ['bbq', 'barbecue', 'grill'],
        '火锅': ['hotpot', 'hot pot'],
        # 服务相关
        '预订': ['reservation', 'booking', 'pre-order', 'preorder'],
        '取消': ['cancel', 'cancellation'],
        '退款': ['refund'],
        '配送': ['delivery'],
        '自取': ['pickup', 'pick up', 'takeaway'],
        '堂食': ['dine in', 'dine-in', 'eat in'],
        '外带': ['takeaway', 'take out', 'take-out'],
        'WiFi': ['wifi', 'wi-fi', 'password'],
        '密码': ['password'],
        '停车': ['parking'],
        '座位': ['seat', 'seating'],
        # 英文→中文
        'opening hours': ['营业时间'],
        'business hours': ['营业时间'],
        'trading hours': ['营业时间'],
        'minimum order': ['最低订单', '最低消费'],
        'minimum spend': ['最低消费', '最低订单'],
        'dessert': ['甜品'],
        'desserts': ['甜品'],
        'main course': ['主食'],
        'mains': ['主食'],
        'drinks': ['饮品'],
        'beverage': ['饮品'],
        'beverages': ['饮品'],
        'seafood': ['海鲜'],
        'dim sum': ['点心'],
        'dumpling': ['饺子'],
        'dumplings': ['饺子'],
        'noodle': ['面条'],
        'noodles': ['面条'],
        'soup': ['汤'],
        'salad': ['沙拉'],
        'bbq': ['烧烤', '烧烤'],
        'barbecue': ['烧烤'],
        'hotpot': ['火锅'],
        'hot pot': ['火锅'],
        'reservation': ['预订'],
        'booking': ['预订'],
        'pre-order': ['预订'],
        'preorder': ['预订'],
        'cancellation': ['取消'],
        'refund': ['退款'],
        'delivery': ['配送'],
        'takeaway': ['外带', '自取'],
        'take out': ['外带'],
        'dine in': ['堂食'],
        'dine-in': ['堂食'],
        'parking': ['停车'],
        'password': ['密码'],
        'menu': ['菜单'],
        'price': ['价格'],
        'discount': ['折扣', '优惠'],
        'promotion': ['优惠'],
        'combo': ['套餐'],
        'set menu': ['套餐'],
        'package': ['套餐'],
        'weekend': ['周末'],
        'weekdays': ['工作日'],
        'public holiday': ['节假日'],
        'holidays': ['节假日'],
        'restriction': ['限制'],
        'restricted': ['限制'],
    }

    def _bilingual_expand(self, keyword: str) -> List[str]:
        """Expand a keyword with its bilingual equivalents."""
        kw_lower = keyword.lower().strip()
        equivs = self._BILINGUAL_DICT.get(kw_lower, [])
        # Also try matching with common suffixes stripped (e.g., "营业时间的" → "营业时间")
        if not equivs and len(kw_lower) > 2:
            for suffix in ['的', '了', '在', '是']:
                if kw_lower.endswith(suffix):
                    base = kw_lower[:-1]
                    equivs = self._BILINGUAL_DICT.get(base, [])
                    if equivs:
                        break
        return equivs

    def _has_keyword_match(self, content: str, keywords: List[str]) -> bool:
        """Check if content contains any keyword (case-insensitive)."""
        if not keywords:
            return True  # No keywords = don't filter
        content_lower = content.lower()
        return any(kw.lower() in content_lower for kw in keywords)

    def random_sample(self, user_id: str, doc_type: str, n: int = 2) -> List[Dict[str, Any]]:
        """Pick n random chunks from a collection for style diversity."""
        collection = self._get_user_collection(user_id, doc_type)
        try:
            all_data = collection.get()
            if not all_data["documents"]:
                return []
            import random
            indices = random.sample(range(len(all_data["documents"])), min(n, len(all_data["documents"])))
            results = []
            for idx in indices:
                results.append({
                    "content": all_data["documents"][idx],
                    "metadata": all_data["metadatas"][idx],
                })
            return results
        except Exception:
            return []

    def list_documents(self, user_id: str, doc_type: str) -> List[Dict[str, Any]]:
        collection = self._get_user_collection(user_id, doc_type)
        try:
            all_data = collection.get()
            if not all_data["metadatas"]:
                return []
            doc_ids = set()
            for meta in all_data["metadatas"]:
                doc_ids.add(meta["doc_id"])

            documents = []
            for doc_id in doc_ids:
                first_chunk = collection.get(where={"doc_id": doc_id}, limit=1)
                if first_chunk["metadatas"]:
                    meta = first_chunk["metadatas"][0]
                    documents.append({
                        "doc_id": doc_id,
                        "filename": meta["filename"],
                        "preview": meta.get("content_preview", ""),
                        "created_at": meta.get("created_at", ""),
                        "content_size": meta.get("content_size", ""),
                        "source_url": meta.get("source_url", ""),
                    })
            return documents
        except Exception:
            return []

    def get_document_content(self, user_id: str, doc_type: str, doc_id: str) -> str:
        collection = self._get_user_collection(user_id, doc_type)
        try:
            results = collection.get(where={"doc_id": doc_id})
            if not results["metadatas"]:
                return ""
            chunks = sorted(
                zip(results["documents"], results["metadatas"]),
                key=lambda x: x[1].get("chunk_index", 0)
            )
            return "\n\n".join(doc for doc, _ in chunks)
        except Exception:
            return ""

    def delete_document(self, user_id: str, doc_type: str, doc_id: str):
        collection = self._get_user_collection(user_id, doc_type)
        try:
            results = collection.get(where={"doc_id": doc_id})
            if results["ids"]:
                collection.delete(ids=results["ids"])
        except Exception:
            pass

    def _split_text(self, text: str, chunk_size: int = 500) -> List[str]:
        """Layout-aware chunking: keeps structured items (menu items + prices) together."""
        chunks = []
        paragraphs = text.split("\n\n")
        current_chunk = ""

        for paragraph in paragraphs:
            para = paragraph.strip()
            if not para:
                continue

            # Check if this paragraph is a "structured item" (e.g., menu item with price,
            # or an annotation block like [TIME THRESHOLD], [REQUIREMENT], [PRICE LOOKUP])
            is_structured = bool(re.search(
                r'\d+(?:\.\d+)?\s*(?:pp|per|/pp|每位|一位)?\s*$'
                r'|^\[.+?\]'
                r'|^---\s+.+\s+---$'
                r'|^\[CRITICAL ORDERING RULES'
                r'|^\[PRICE LOOKUP INDEX',
                para, re.MULTILINE
            ))

            if is_structured:
                # Structured items: try to keep with previous chunk if small enough
                # Otherwise flush current and start new
                candidate = (current_chunk + "\n\n" + para).strip() if current_chunk else para
                if len(candidate) <= chunk_size * 1.5:  # Allow 50% over chunk_size for structured items
                    current_chunk = candidate
                else:
                    if current_chunk:
                        chunks.append(current_chunk.strip())
                    current_chunk = para
            else:
                # Regular paragraph: standard size-based splitting
                if len(current_chunk) + len(para) + 2 <= chunk_size:
                    current_chunk += para + "\n\n"
                else:
                    if current_chunk:
                        chunks.append(current_chunk.strip())
                    # If single paragraph exceeds chunk_size, split by sentence
                    if len(para) > chunk_size:
                        sentences = re.split(r'(?<=[。！？.!?])\s*', para)
                        buf = ""
                        for sent in sentences:
                            if len(buf) + len(sent) + 1 <= chunk_size:
                                buf += sent + " "
                            else:
                                if buf:
                                    chunks.append(buf.strip())
                                buf = sent + " "
                        current_chunk = buf
                    else:
                        current_chunk = para + "\n\n"

        if current_chunk.strip():
            chunks.append(current_chunk.strip())

        return chunks if chunks else [text]
