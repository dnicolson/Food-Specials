import importlib.util
import unittest
from pathlib import Path


spec = importlib.util.spec_from_file_location("fetch_ubereats", Path(__file__).resolve().parents[1] / "scripts/fetch-ubereats.py")
fetcher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fetcher)


class OfferTests(unittest.TestCase):
    def test_availability_badges_are_not_promotions(self):
        labels = ["Opens 12:00 PM • Schedule ahead", "Closed", "Buy 1, get 1", "30% off select items", "2 für 1 Deal", "Free item on €15+"]
        self.assertEqual(fetcher.offer_labels(labels), labels[2:])

    def test_deduplicates_menu_items_and_omits_unavailable_items(self):
        item = {"id": "burger", "name": "Burger", "price": 8.4,
                "promotion": {"type": "buy_x_get_y", "buy_quantity": 1, "get_quantity": 1, "max_redemptions": 3}}
        sections = [{"categories": [{"items": [item, dict(item), {**item, "id": "sold-out", "is_sold_out": True}]}]}]
        offers = fetcher.promotion_items(sections)
        self.assertEqual(len(offers), 1)
        self.assertEqual(offers[0]["offer"], "Buy 1, get 1 free")
        self.assertEqual(offers[0]["max_redemptions"], 3)


if __name__ == "__main__":
    unittest.main()
