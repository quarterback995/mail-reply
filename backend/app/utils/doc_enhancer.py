"""
General-purpose document text enhancer for RAG grounding.

Post-processes extracted text to detect and annotate patterns:
- Price-item associations (for reverse price lookup)
- Time-based restrictions (linked to nearby items)
- Minimum order / quantity requirements
- Section headers and item groupings
"""
import re
from typing import List, Dict, Tuple, Optional


def enhance_document_text(text: str, filename: str = "") -> str:
    """Enhance extracted document text with structural annotations for better RAG.

    Works for any document type (menu, policy, catalog, etc.).
    """
    lines = text.split("\n")
    enhanced_lines = []
    annotations = []
    price_index = {}
    restrictions = []
    current_section = ""
    active_restriction = None  # Track restriction that applies to subsequent items
    section_start_idx = 0  # Index where current section items start in enhanced_lines

    i = 0
    while i < len(lines):
        line = lines[i].strip()
        if not line:
            enhanced_lines.append("")
            i += 1
            continue

        # Collect context window (up to 3 lines before and after)
        context_before = [lines[j].strip() for j in range(max(0, i-3), i) if lines[j].strip()]
        context_after = [lines[j].strip() for j in range(i+1, min(len(lines), i+4)) if lines[j].strip()]

        # Skip noise lines (ingredient lists, pure separators, serving notes)
        stripped = line.strip()
        if stripped.startswith("("):
            i += 1
            continue
        if re.match(r"^[-—]+$", stripped):
            i += 1
            continue
        if stripped.lower() in ("one serve", "choose one", "regular", "seasonal price"):
            i += 1
            continue
        # Skip ingredient/description lines (comma-separated food words without prices)
        if not re.search(r'\d', stripped) and "," in stripped and len(stripped) < 100:
            i += 1
            continue

        # 1. Detect time restrictions — only annotate items AFTER this point
        restriction = _detect_time_restriction(line, context_after)
        if restriction:
            restrictions.append(restriction)
            active_restriction = restriction
            enhanced_lines.append(f"[TIME RESTRICTION] {line}")
            i += 1
            continue

        # 2. Detect section headers FIRST — before item check to avoid misclassification
        if _is_section_header(line):
            current_section = line
            active_restriction = None  # Reset restriction on new section
            section_start_idx = len(enhanced_lines)
            # Strip existing --- prefix/suffix to avoid double-wrapping
            clean_header = re.sub(r'^[-—\s]+|[-—\s]+$', '', line).upper()
            enhanced_lines.append(f"\n--- {clean_header} ---")
            i += 1
            continue

        # 3. Detect minimum order / quantity requirements — annotate only the most recent item
        min_order = _detect_min_order(line)
        if min_order:
            # Find the most recent item (not a section header or annotation line) to annotate
            for j in range(len(enhanced_lines) - 1, -1, -1):
                if enhanced_lines[j].startswith("---") or enhanced_lines[j].startswith("["):
                    continue
                if "[" not in enhanced_lines[j]:  # Not already annotated
                    enhanced_lines[j] = f"{enhanced_lines[j]}  [REQUIREMENT: {line.strip()}]"
                    break
            annotations.append({**min_order, "text": line.strip()})
            enhanced_lines.append(f"[REQUIREMENT] {line.strip()}")
            i += 1
            continue

        # 4. Detect item with price and build cross-line context
        item_info = _detect_item_with_price(line, context_before, context_after)
        if item_info:
            # Annotate with restriction if one is active for subsequent items
            suffix = f"  [{active_restriction}]" if active_restriction else ""
            if item_info.get("cross_line_context"):
                suffix += f"  [Note: {item_info['cross_line_context']}]"
            enhanced_lines.append(f"{line}{suffix}")

            # Build price index
            if item_info.get("price") and item_info.get("name"):
                price = item_info["price"]
                name = item_info["name"]
                price_index.setdefault(price, []).append(name)
            i += 1
            continue

        # Default: keep line as-is, with restriction annotation if active
        if active_restriction:
            enhanced_lines.append(f"{line}  [{active_restriction}]")
        else:
            enhanced_lines.append(line)
        i += 1

    # Build CRITICAL RULES section (placed at top for RAG retrieval)
    rules_section = ""
    if restrictions or annotations:
        rules_section += "\n[CRITICAL ORDERING RULES — MUST follow these when answering]\n"
        for r in restrictions:
            rules_section += f"  • {r}\n"
        for a in annotations:
            rules_section += f"  • {a.get('text', '')}\n"

    # Build price reverse-lookup index
    if price_index:
        rules_section += "\n[PRICE LOOKUP INDEX — when customer mentions a price, find the item here]\n"
        for price, items in sorted(price_index.items(), key=lambda x: float(x[0]) if x[0].replace('.','').isdigit() else 0):
            rules_section += f"  ${price}: {'; '.join(items[:5])}\n"

    # Assemble: rules FIRST, then item list
    item_list = "\n".join(enhanced_lines)
    result = rules_section + "\n" + item_list if rules_section else item_list

    return result


def _parse_time_to_minutes(time_str: str) -> Optional[int]:
    """Convert a time string to minutes since midnight (e.g., '6pm'→1080, '5:30pm'→1050)."""
    time_str = time_str.strip().lower()
    m = re.match(r'(\d{1,2})(?::(\d{2}))?\s*(am|pm)?', time_str)
    if not m:
        return None
    hour = int(m.group(1))
    minute = int(m.group(2) or 0)
    period = m.group(3)
    if period == 'pm' and hour != 12:
        hour += 12
    elif period == 'am' and hour == 12:
        hour = 0
    if 0 <= hour <= 23 and 0 <= minute <= 59:
        return hour * 60 + minute
    return None


def _minutes_to_hhmm(minutes: int) -> str:
    """Convert minutes since midnight to HH:MM format."""
    return f"{minutes // 60:02d}:{minutes % 60:02d}"


def _extract_time_annotation(line: str) -> Optional[str]:
    """Extract time thresholds/ranges from a line and return numeric annotation.

    Examples:
        'After 6pm' → '[TIME THRESHOLD: after 18:00]'
        'Not available after 10pm' → '[TIME THRESHOLD: not available after 22:00]'
        'Lunch: 11:30am-2:30pm' → '[TIME RANGE: 11:30-14:30]'
    """
    lower = line.lower()

    # "after Xpm/am" or "not available after Xpm"
    m = re.search(r'(?:not\s+available\s+)?after\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm))', lower)
    if m:
        minutes = _parse_time_to_minutes(m.group(1))
        if minutes is not None:
            prefix = "not available " if "not available" in lower else ""
            return f"[TIME THRESHOLD: {prefix}after {_minutes_to_hhmm(minutes)}]"

    # "before Xpm/am" or "until Xpm"
    m = re.search(r'(?:before|until|up\s+to)\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm))', lower)
    if m:
        minutes = _parse_time_to_minutes(m.group(1))
        if minutes is not None:
            return f"[TIME THRESHOLD: before {_minutes_to_hhmm(minutes)}]"

    # "from X to Y" / "between X and Y" / "X-Y" time range
    m = re.search(
        r'(?:from|between)\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm))\s*(?:to|and|[-–])\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm))',
        lower
    )
    if not m:
        m = re.search(
            r'hours?:?\s*(\d{1,2}:\d{2})\s*[-–]\s*(\d{1,2}:\d{2})',
            lower
        )
    if m:
        start = _parse_time_to_minutes(m.group(1))
        end = _parse_time_to_minutes(m.group(2))
        if start is not None and end is not None:
            return f"[TIME RANGE: {_minutes_to_hhmm(start)}-{_minutes_to_hhmm(end)}]"

    return None


def _detect_time_restriction(line: str, context_after: List[str]) -> Optional[str]:
    """Detect time-based ordering restrictions and annotate with numeric time values."""
    lower = line.lower()

    patterns = [
        r"not available after \d+\s*(?:pm|am)",
        r"available (?:only )?(?:from|between) .+ (?:to|and|until) .+",
        r"(?:after|before|until)\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)",
        r"weekdays? only",
        r"weekends? (?:only|not available|excluded)",
        r"not available on (?:weekends?|public holidays?|school holidays?)",
        r"hours?:?\s*\d{1,2}:\d{2}\s*[-–]\s*\d{1,2}:\d{2}",
    ]

    for pattern in patterns:
        if re.search(pattern, lower):
            # Try to extract numeric time annotation
            annotation = _extract_time_annotation(line)
            if annotation:
                return f"{line.strip()} {annotation}"
            return line.strip()

    return None


def _detect_min_order(line: str) -> Optional[Dict]:
    """Detect minimum order / quantity requirements."""
    lower = line.lower()
    patterns = [
        r"minimum order (?:of )?\d+",
        r"min\.?\s*(?:order|qty)[:\s]*\d+",
        r"at least \d+",
        r"\d+\s*(?:person|people|pax|位|人)\s*(?:min|minimum|起)",
    ]

    for pattern in patterns:
        if re.search(pattern, lower):
            return {"type": "min_order", "text": line}
    return None


def _detect_item_with_price(line: str, context_before: List[str], context_after: List[str]) -> Optional[Dict]:
    """Detect a menu/product item with its price, including cross-line association."""
    # Price must be at END of line, preceded by a word char or CJK char
    # Valid: "Chicken Soup 9.9", "佛跳墙 99 pp", "鲍鱼 35 pp / 一位"
    # Invalid: "(3) 8.9" (portion count), "password: 88888888"
    price_match = re.search(
        r'(?:^|\s)(\d{1,3}(?:\.\d{1,2})?)\s*(?:pp|per\s*(?:person|pound)|/pp|每位|一位)?(?:\s*/\s*.+)?\s*$',
        line
    )
    seasonal = bool(re.search(r'时价|seasonal\s*price|market\s*price', line, re.IGNORECASE))

    if not price_match and not seasonal:
        return None

    price = price_match.group(1) if price_match else "时价"

    # Validate price range (reject WiFi passwords, unreasonable prices)
    if price != "时价":
        try:
            p = float(price)
            if p > 500 or p < 0.5:
                return None
        except ValueError:
            return None

    # Extract item name (text before price)
    name = line[:price_match.start()].strip() if price_match else line
    # Remove trailing Chinese characters and symbols
    name = re.sub(r'[一-鿿]+.*$', '', name).strip()
    name = name.rstrip("-—:：").strip()

    if not name or len(name) < 3:
        return None

    # Cross-line association: only add context from lines that are genuine continuations
    cross_context = _find_cross_line_context(name, context_before, context_after)

    return {
        "name": name,
        "price": price,
        "seasonal": seasonal,
        "cross_line_context": cross_context,
    }


def _find_cross_line_context(item_name: str, before: List[str], after: List[str]) -> Optional[str]:
    """Find related information from adjacent lines (only genuine continuations)."""
    context_parts = []

    # Only check the immediate next line, and only if it looks like a continuation
    # (not a standalone item with price)
    if after:
        next_line = after[0]
        # Skip if next line is a standalone item (has price at end)
        if re.search(r'\d+(?:\.\d+)?\s*$', next_line.strip()):
            return None
        # Include if it's options, ingredients, or modifiers
        lower = next_line.lower()
        if any(kw in lower for kw in [
            "style", "sauce", "option", "type", "flavor", "choose",
            "ginger", "garlic", "black bean", "xo", "truffle",
            "steamed", "fried", "boiled", "baked",
            "preorder", "minimum", "seasonal",
        ]):
            context_parts.append(next_line)

    return "; ".join(context_parts) if context_parts else None


def _is_section_header(line: str) -> bool:
    """Detect section/category headers."""
    headers = [
        r"(?:entree|appetizer|starter)s?\b",
        r"(?:main|dish|course)s?\b",
        r"dumpling",
        r"dim\s*sum",
        r"seafood",
        r"vegetable",
        r"\bside\b",
        r"dessert",
        r"\bdrink",
        r"beverage",
        r"\blunch\b",
        r"\bdinner\b",
        r"special",
        r"noodle",
        r"\brice\b",
        r"\bsoup\b",
        r"\bsalad\b",
        r"\bsushi\b",
        r"\bsashimi\b",
        r"yakitori",
        r"robata",
        r"teppanyaki",
        r"hotpot",
        r"\bbbq\b",
        r"set\s*(?:menu|meal|course)",
        r"\bcombo\b",
        r"\bplatter\b",
        r"\bsharing\b",
        r"\bfamily\b",
        r"\bkids?\b",
        r"\bchildren",
        r"breakfast",
        r"brunch",
        r"high\s*tea",
        r"\bsnack",
        r"\bbread\b",
        r"\bcake\b",
        r"\bpastry",
        r"\bcoffee\b",
        r"\btea\b",
        r"\bjuice\b",
        r"\bsmoothie\b",
        r"\bcocktail",
        r"\bwine\b",
        r"\bbeer\b",
        r"\bspirit",
        r"私房菜",
        r"海鲜",
        r"素菜",
        r"甜品",
        r"饺子",
        r"点心",
        r"主食",
        r"汤类",
        r"凉菜",
        r"热菜",
        r"小吃",
        r"饮品",
        r"酒水",
    ]
    lower = line.lower().strip()
    # Match if line is a known header pattern AND is short (not a menu item with price)
    return any(re.search(h, lower) for h in headers) and len(line) < 50 and not re.search(r'\d+\.\d+', line)
