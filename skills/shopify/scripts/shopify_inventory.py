#!/usr/bin/env python3
"""Shopify Inventory CLI — list, adjust, set (Admin API)."""

import argparse
import json
import os
import urllib.request

ENV_FILE_CANDIDATES = [".env", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", ".env")]


def load_env_file():
    for cand in ENV_FILE_CANDIDATES:
        if os.path.isfile(cand):
            with open(cand) as f:
                for line in f:
                    line = line.strip()
                    if not line or line.startswith("#") or "=" not in line:
                        continue
                    key, _, value = line.partition("=")
                    key, value = key.strip(), value.strip().strip("'\"")
                    os.environ.setdefault(key, value)


def get_config():
    load_env_file()
    config = {"store": "", "token": "", "api_version": "2024-10"}
    cfg_file = os.path.expanduser("~/.shopify/config.json")
    if os.path.exists(cfg_file):
        try:
            with open(cfg_file) as f:
                disk = json.load(f)
            config["store"] = str(disk.get("store", ""))
            config["token"] = str(disk.get("token", ""))
            config["api_version"] = str(disk.get("api_version", config["api_version"]))
        except (OSError, ValueError):
            pass
    config["store"] = os.environ.get("SHOPIFY_STORE_DOMAIN") or os.environ.get("SHOPIFY_STORE") or config["store"]
    config["token"] = os.environ.get("SHOPIFY_ADMIN_TOKEN") or os.environ.get("SHOPIFY_TOKEN") or config["token"]
    config["api_version"] = os.environ.get("SHOPIFY_API_VERSION") or config["api_version"]
    return config


def graphql_query(query, variables=None):
    config = get_config()
    if not config["store"] or not config["token"]:
        raise SystemExit("Manca SHOPIFY_STORE_DOMAIN / SHOPIFY_ADMIN_TOKEN (o ~/.shopify/config.json)")
    url = f"https://{config['store']}/admin/api/{config['api_version']}/graphql.json"
    payload = {"query": query}
    if variables:
        payload["variables"] = variables
    data = json.dumps(payload).encode()
    req = urllib.request.Request(url, data=data, method="POST")
    req.add_header("X-Shopify-Access-Token", config["token"])
    req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        raise SystemExit(f"HTTP {e.code}: {e.read().decode()}") from e


def list_inventory(limit=10):
    query = """
    query($first: Int!) {
        inventoryItems(first: $first) {
            edges {
                node {
                    id sku title
                    inventoryLevels(first: 5) {
                        edges { node { id available location { name } } }
                    }
                }
            }
        }
    }
    """
    result = graphql_query(query, {"first": limit})
    for edge in result["data"]["inventoryItems"]["edges"]:
        item = edge["node"]
        levels = ", ".join([
            f"{n['location']['name']}: {n['available']}"
            for n in item["inventoryLevels"]["edges"]
        ])
        print(f"{item['sku']} | {item['title']} | {levels}")


def adjust_inventory(level_id, delta):
    query = """
    mutation($input: InventoryAdjustQuantityInput!) {
        inventoryAdjustQuantity(input: $input) {
            inventoryLevel { id available }
            userErrors { field message }
        }
    }
    """
    result = graphql_query(query, {"input": {"inventoryLevelId": level_id, "delta": delta}})
    print(json.dumps(result["data"], indent=2))


def set_inventory(level_id, quantity):
    query = """
    mutation($input: InventorySetQuantitiesInput!) {
        inventorySetQuantities(input: $input) {
            inventoryLevel { id available }
            userErrors { field message }
        }
    }
    """
    result = graphql_query(query, {"input": {
        "inventoryLevelId": level_id,
        "quantity": quantity,
        "name": "available",
    }})
    print(json.dumps(result["data"], indent=2))


def main():
    parser = argparse.ArgumentParser(description="Shopify Inventory CLI")
    sub = parser.add_subparsers(dest="command")

    list_p = sub.add_parser("list")
    list_p.add_argument("--limit", type=int, default=10)

    adj_p = sub.add_parser("adjust")
    adj_p.add_argument("--level-id", required=True)
    adj_p.add_argument("--delta", type=int, required=True)

    set_p = sub.add_parser("set")
    set_p.add_argument("--level-id", required=True)
    set_p.add_argument("--quantity", type=int, required=True)

    args = parser.parse_args()
    if args.command == "list":
        list_inventory(args.limit)
    elif args.command == "adjust":
        adjust_inventory(args.level_id, args.delta)
    elif args.command == "set":
        set_inventory(args.level_id, args.quantity)
    else:
        parser.print_help()


if __name__ == "__main__":
    main()