"""
Menu PDF preprocessor for enhanced RAG grounding.

Extracts structured menu data from PDF text, adding:
- Cross-line associations (Chinese ↔ English ↔ Price)
- Time restrictions linked to specific items
- Price lookup index for reverse search
"""
import re
from typing import List, Dict, Tuple


def preprocess_menu(pdf_text: str) -> str:
    """Convert raw PDF-extracted menu text into structured, RAG-optimized format."""
    sections = _split_sections(pdf_text)
    output_parts = []

    # Build structured sections
    all_items = []
    time_restrictions = []

    for section_name, lines in sections:
        section_items, section_restrictions = _parse_section(section_name, lines)
        all_items.extend(section_items)
        time_restrictions.extend(section_restrictions)

    # Output structured menu by section
    for section_name, lines in sections:
        section_items, section_restrictions = _parse_section(section_name, lines)
        if not section_items:
            continue

        output_parts.append(f"\n{'='*60}")
        output_parts.append(f"SECTION: {section_name}")
        if section_restrictions:
            for r in section_restrictions:
                output_parts.append(f"⚠️ TIME RESTRICTION: {r}")
        output_parts.append(f"{'='*60}")

        for item in section_items:
            output_parts.append(_format_item(item))

    # Add price index for reverse lookup
    if all_items:
        output_parts.append(f"\n{'='*60}")
        output_parts.append("PRICE INDEX (for reverse lookup when customer mentions a price)")
        output_parts.append(f"{'='*60}")
        price_groups = _group_by_price(all_items)
        for price, items in sorted(price_groups.items()):
            names = ", ".join(items[:3])
            output_parts.append(f"  ${price}: {names}")

    # Add time restriction summary
    if time_restrictions:
        output_parts.append(f"\n{'='*60}")
        output_parts.append("TIME-BASED ORDERING RULES (MUST follow these strictly)")
        output_parts.append(f"{'='*60}")
        for r in time_restrictions:
            output_parts.append(f"  • {r}")

    return "\n".join(output_parts)


def _split_sections(text: str) -> List[Tuple[str, List[str]]]:
    """Split menu text into named sections."""
    section_keywords = {
        "Entrees": "Entrees / Appetizers",
        "Dumplings": "Dumplings",
        "Mains": "Mains / Private Kitchen (私房菜)",
        "Premium Seafood": "Premium Seafood (海鲜)",
        "Vegetables": "Vegetables (素菜)",
        "Sides": "Sides & Desserts (主食和甜品)",
        "Lunch Special": "Lunch Special Menu",
    }

    sections = []
    current_name = "General"
    current_lines = []

    for line in text.split("\n"):
        stripped = line.strip()
        if not stripped:
            continue

        # Check if this line is a section header
        matched = False
        for keyword, name in section_keywords.items():
            if keyword.lower() in stripped.lower() and len(stripped) < 50:
                if current_lines:
                    sections.append((current_name, current_lines))
                current_name = name
                current_lines = []
                matched = True
                break

        if not matched:
            current_lines.append(stripped)

    if current_lines:
        sections.append((current_name, current_lines))

    return sections


def _parse_section(name: str, lines: List[str]) -> Tuple[List[Dict], List[str]]:
    """Parse items and restrictions from a section."""
    items = []
    restrictions = []

    for line in lines:
        # Detect time restrictions
        lower = line.lower()
        if "not available after" in lower:
            restrictions.append(line.strip())
            continue
        if "weekday" in lower or "weekend" in lower:
            restrictions.append(line.strip())
            continue
        if re.search(r"\d{1,2}:\d{2}", line) and ("only" in lower or "available" in lower):
            restrictions.append(line.strip())
            continue
        if "preorder" in lower:
            restrictions.append(line.strip())
            continue
        if "minimum order" in lower:
            restrictions.append(line.strip())
            continue

        # Skip pure noise lines
        if re.match(r"^[-—]+$", stripped := line.strip()):
            continue
        if stripped.lower() in ("one serve", "choose one", "regular"):
            continue
        if stripped.startswith("(") and stripped.endswith(")") and len(stripped) < 80:
            continue  # Skip ingredient lists in parens

        # Try to extract item with price
        item = _parse_item_line(line)
        if item:
            items.append(item)

    return items, restrictions


def _parse_item_line(line: str) -> Dict | None:
    """Parse a single menu line into structured item."""
    # Match patterns like: "Dish Name 价格" or "Dish Name Chinese 价格"
    # Price patterns: "35.9", "35 pp", "35 per pound", "时价"
    price_match = re.search(r'(\d+(?:\.\d+)?)\s*(?:pp|per\s*pound|per\s*person)?\b', line)
    seasonal = "时价" in line or "seasonal price" in line.lower()

    if not price_match and not seasonal:
        # Might be a continuation line or header
        if len(line) > 5 and not line.startswith("+"):
            return {"name": line, "price": None, "chinese": "", "raw": line}
        return None

    price = price_match.group(1) if price_match else None

    # Extract Chinese name if present (Unicode range for CJK)
    chinese_match = re.search(r'[一-鿿㐀-䶿]+', line)
    chinese = chinese_match.group(0) if chinese_match else ""

    # Clean name: remove price and Chinese parts
    name = line
    if price_match:
        name = name[:price_match.start()].strip()
    # Remove trailing Chinese
    name = re.sub(r'[一-鿿㐀-䶿]+.*$', '', name).strip()
    # Remove trailing commas, etc
    name = name.rstrip(", ").strip()

    if not name or len(name) < 2:
        return None

    return {
        "name": name,
        "price": price,
        "chinese": chinese,
        "seasonal": seasonal,
        "raw": line,
    }


def _format_item(item: Dict) -> str:
    """Format an item for output."""
    parts = [f"  • {item['name']}"]
    if item.get("chinese"):
        parts.append(f"({item['chinese']})")
    if item.get("seasonal"):
        parts.append("- 时价 (seasonal price)")
    elif item.get("price"):
        parts.append(f"- ${item['price']}")
    if item.get("restrictions"):
        parts.append(f"  ⚠️ {item['restrictions']}")
    return " ".join(parts)


def _group_by_price(items: List[Dict]) -> Dict[str, List[str]]:
    """Group items by price for reverse lookup."""
    groups = {}
    for item in items:
        if item.get("price"):
            price = item["price"]
            label = item["name"]
            if item.get("chinese"):
                label += f" ({item['chinese']})"
            groups.setdefault(price, []).append(label)
    return groups
