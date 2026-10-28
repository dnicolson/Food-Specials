import argparse
import hashlib
import importlib.metadata
import json
import os
import platform
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path


UPSTREAM_COMMIT = "a918dea4da9c658607afb70784b7feeda7cf458d"
BERLIN = {"latitude": 52.5097995, "longitude": 13.4581929}
NEW_YORK = {"latitude": 40.758, "longitude": -73.9855}
EXAMPLE_STORE = "65686398-f585-439b-ae4c-dabe058a0a60"


def describe_response(response):
    body = response.text or ""
    result = {
        "http_status": response.status_code,
        "content_type": response.headers.get("content-type"),
        "cf_mitigated": response.headers.get("cf-mitigated"),
        "bytes": len(response.content),
        "sha256": hashlib.sha256(response.content).hexdigest(),
    }
    try:
        payload = response.json()
    except ValueError:
        lower = body.lower()
        result["classification"] = (
            "cloudflare_challenge"
            if result["cf_mitigated"] == "challenge"
            or "just a moment" in lower or "/cdn-cgi/challenge" in lower
            else "non_json_response"
        )
        return result
    if not isinstance(payload, dict):
        result["classification"] = "unexpected_json_shape"
        return result
    result["rpc_status"] = payload.get("status")
    result["top_level_keys"] = sorted(payload)
    metadata = payload.get("metadata") or {}
    defense = metadata.get("botdefense") if isinstance(metadata, dict) else None
    if isinstance(defense, dict):
        result["bot_defense"] = {k: defense.get(k) for k in ("state", "provider")}
        result["classification"] = "uber_bot_defense"
    elif payload.get("status") == "success":
        result["classification"] = "rpc_success"
    else:
        result["classification"] = "rpc_failure"
        data = payload.get("data")
        if isinstance(data, dict):
            result["rpc_error"] = {k: str(data[k])[:200] for k in ("code", "message") if k in data}
    return result


def public_card(card):
    return {k: card.get(k) for k in ("id", "name", "link", "offers", "location")}


def main():
    cli = argparse.ArgumentParser()
    cli.add_argument("--source", required=True, type=Path)
    cli.add_argument("--output", required=True, type=Path)
    args = cli.parse_args()
    source = args.source.resolve()
    commit = subprocess.check_output(["git", "-C", str(source), "rev-parse", "HEAD"], text=True).strip()
    if commit != UPSTREAM_COMMIT:
        raise SystemExit("Upstream commit does not match the pinned diagnostic version")
    for name in ("UBER_EATS_PROXY", "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY",
                 "http_proxy", "https_proxy", "all_proxy"):
        if os.environ.get(name):
            raise SystemExit("Direct diagnostic requires proxy environment variables to be unset")
    os.environ.pop("UBER_EATS_DEBUG_DIR", None)
    sys.path.insert(0, str(source))
    import config
    from uber_eats import fetch, parsers

    config.MAX_RETRIES = 1
    fetch.TIMEOUT = 25
    args.output.mkdir(parents=True, exist_ok=True)
    report = {
        "started_at": datetime.now(timezone.utc).isoformat(),
        "upstream_commit": commit,
        "python": platform.python_version(),
        "platform": platform.system(),
        "architecture": platform.machine(),
        "dependencies": {name: importlib.metadata.version(name) for name in ("curl_cffi", "cffi", "certifi", "pycparser")},
        "transport": "upstream curl_cffi chrome impersonation, direct, one attempt",
        "results": [],
    }

    def run_case(label, rpc, body, locale="us", point=None, kind="feed"):
        fetch._drop_session()
        session = fetch._session()
        original_post = session.post
        result = {"case": label, "rpc": rpc, "locale": locale, "point": point}

        def observed_post(*positional, **kwargs):
            response = original_post(*positional, **kwargs)
            result.update(describe_response(response))
            return response

        session.post = observed_post
        started = time.monotonic()
        cards = []
        try:
            raw = fetch.rpc(rpc, body, locale=locale, point=point)
            result["retrieval_succeeded"] = True
            if kind == "feed":
                collections = parsers.feed_collections(raw, country=locale)
                stores = parsers.feed_stores(raw, country=locale)
                stores += [card for collection in collections for card in collection.get("stores", [])]
                cards = list({card["id"]: public_card(card) for card in stores if card.get("id")}.values())
                offers = [card for card in cards if card["offers"]]
                result.update({
                    "store_count": len(cards),
                    "stores_with_offer_labels": len(offers),
                    "collection_titles": [c.get("title") for c in collections],
                    "offer_samples": offers[:5],
                })
                (args.output / (label + "-stores.json")).write_text(json.dumps(cards, indent=2, ensure_ascii=False) + "\n")
            elif kind == "store":
                details = parsers.store_details(raw, has_point=point is not None)
                sections = parsers.menu_sections(raw)
                result.update({"store_name": details.get("name"), "menu_section_count": len(sections)})
                promotions = []

                def collect(value):
                    if isinstance(value, dict):
                        if value.get("promotion") or value.get("promotion_text"):
                            promotions.append({k: value.get(k) for k in ("id", "name", "price", "promotion", "promotion_text")})
                        for child in value.values():
                            collect(child)
                    elif isinstance(value, list):
                        for child in value:
                            collect(child)

                collect(sections)
                result["promoted_item_count"] = len(promotions)
                result["promotion_samples"] = promotions[:5]
            else:
                result["address_result_count"] = len(raw) if isinstance(raw, list) else None
        except Exception as error:
            result["error_type"] = type(error).__name__
            result.setdefault("classification", "transport_error")
            result["stage"] = "parsing" if result.get("retrieval_succeeded") else "retrieval"
        finally:
            fetch._drop_session()
            result["seconds"] = round(time.monotonic() - started, 2)
            report["results"].append(result)
            (args.output / "report.json").write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n")
            print(json.dumps(result, ensure_ascii=False), flush=True)
        return cards

    run_case("example-store", "getStoreV1", {
        "storeUuid": EXAMPLE_STORE, "diningMode": "DELIVERY", "time": {"asap": True}, "cbType": "EATER_ENDORSED",
    }, kind="store")
    feed_body = {"userQuery": "", "sortAndFilters": [], "pageInfo": {"offset": 0, "pageSize": 80}}
    berlin_store_checked = False
    for label, locale, point in (
        ("new-york-feed", "us", NEW_YORK),
        ("berlin-default-locale", "us", BERLIN),
        ("berlin-de-locale", "de", BERLIN),
        ("berlin-de-en-locale", "de-en", BERLIN),
    ):
        time.sleep(2)
        cards = run_case(label, "getFeedV1", feed_body, locale, point)
        if point == BERLIN and cards and not berlin_store_checked:
            card = next((c for c in cards if c["offers"]), cards[0])
            time.sleep(2)
            run_case("berlin-store", "getStoreV1", {
                "storeUuid": card["id"], "diningMode": "DELIVERY", "time": {"asap": True}, "cbType": "EATER_ENDORSED",
            }, locale, point, "store")
            berlin_store_checked = True
    time.sleep(2)
    run_case("address-control", "mapsSearchV1", {"query": "Times Square New York"}, kind="address")
    report["finished_at"] = datetime.now(timezone.utc).isoformat()
    report["berlin_offers_found"] = any(
        r.get("point") == BERLIN and r.get("stores_with_offer_labels", 0) > 0 for r in report["results"]
    )
    (args.output / "report.json").write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n")
    return 0 if report["berlin_offers_found"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
