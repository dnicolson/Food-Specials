import json
import sys
from datetime import datetime, timezone
from pathlib import Path


def promotion_items(sections):
    items = {}
    for section in sections:
        for category in section.get("categories", []):
            for item in category.get("items", []):
                promotion = item.get("promotion") or {}
                label = item.get("promotion_text")
                if not label and promotion.get("type") == "buy_x_get_y":
                    buy, free = promotion.get("buy_quantity"), promotion.get("get_quantity")
                    if buy and free:
                        label = f"Buy {buy}, get {free} free"
                if not label or item.get("is_sold_out") or item.get("is_available") is False:
                    continue
                key = item.get("id") or item.get("name")
                items[key] = {
                    "name": item.get("name"), "price": item.get("price"),
                    "link": item.get("link"), "offer": label,
                    "max_redemptions": promotion.get("max_redemptions"),
                }
    return list(items.values())


def main():
    sys.path.insert(0, str(Path(sys.argv[1]).resolve()))
    import config
    from uber_eats import fetch, parsers

    config.MAX_RETRIES = 1
    fetch.TIMEOUT = 15
    request = json.load(sys.stdin)
    point, locale = request["point"], request["locale"]
    feed = fetch.rpc("getFeedV1", {
        "userQuery": "", "sortAndFilters": [], "pageInfo": {"offset": 0, "pageSize": 80},
    }, point=point, locale=locale)
    if not isinstance(feed, dict) or not isinstance(feed.get("feedItems"), list):
        raise ValueError("Unexpected Uber Eats feed shape")
    collections = parsers.feed_collections(feed, country=locale)
    cards = [card for shelf in collections for card in shelf.get("stores", [])]
    cards += parsers.feed_stores(feed, country=locale)
    unique = {}
    for card in cards:
        if card.get("id") and card.get("offers") and card.get("name") and card.get("link"):
            unique.setdefault(card["id"], card)
    stores = list(unique.values())[:20]
    fetch_menus = True
    menu_failures = 0
    for card in stores:
        card["items"] = []
        card["currency"] = feed.get("currencyCode")
        card["menu_available"] = False
        if not fetch_menus:
            continue
        try:
            raw = fetch.rpc("getStoreV1", {
                "storeUuid": card["id"], "diningMode": "DELIVERY", "time": {"asap": True},
                "cbType": "EATER_ENDORSED",
            }, point=point, locale=locale)
            details = parsers.store_details(raw, country=locale, has_point=True)
            if not details.get("id"):
                raise ValueError("Unexpected Uber Eats store shape")
            card["items"] = promotion_items(parsers.menu_sections(raw, country=locale))
            card["currency"] = details.get("currency") or card["currency"]
            if details.get("promotion") and details["promotion"] not in card["offers"]:
                card["offers"].append(details["promotion"])
            card["menu_available"] = True
        except Exception as error:
            menu_failures += 1
            print(f"Uber Eats menu unavailable for {card['name']}: {type(error).__name__}", file=sys.stderr)
            if isinstance(error, fetch.UberEatsBlocked) or menu_failures >= 3:
                fetch_menus = False
    print(json.dumps({
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "total_offer_stores": len(unique),
        "stores": [{k: card.get(k) for k in (
            "id", "name", "link", "offers", "items", "currency", "menu_available",
        )} for card in stores],
    }, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"Uber Eats retrieval failed: {type(error).__name__}", file=sys.stderr)
        raise SystemExit(1)
