#!/usr/bin/env python3
"""Shopify Orders CLI — list, get, fulfill (Admin API).

`fulfill` creates a real fulfillment (tracking company + number) from the
order's line items — this is what triggers the `order/fulfilled` webhook that
updates courier + delivery status on the CRM order (demo Atto 0 memory beat).
"""

import argparse
import json
import os
import sys
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
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read())


def rest_request(method, path, body=None):
    config = get_config()
    url = f"https://{config['store']}/admin/api/{config['api_version']}{path}"
    data = json.dumps(body).encode() if body else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("X-Shopify-Access-Token", config["token"])
    req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        raise SystemExit(f"HTTP {e.code}: {e.read().decode()}") from e


def list_orders(limit=10, status="any"):
    query = """
    query($first: Int!, $query: String!) {
        orders(first: $first, query: $query, sortKey: CREATED_AT, reverse: true) {
            edges {
                node {
                    id orderNumber name email financialStatus fulfillmentStatus
                    totalPrice { amount currencyCode }
                    createdAt
                }
            }
        }
    }
    """
    q = f"status:{status}" if status != "any" else ""
    result = graphql_query(query, {"first": limit, "query": q})
    for edge in result["data"]["orders"]["edges"]:
        o = edge["node"]
        total = o["totalPrice"]["amount"]
        print(f"{o['orderNumber']} | {o['name']} | {o['email']} | ${total} | {o['financialStatus']} | {o['fulfillmentStatus']} | {o['id']}")


def get_order(order_id):
    query = """
    query($id: ID!) {
        order(id: $id) {
            id orderNumber name email phone
            financialStatus fulfillmentStatus
            totalPrice { amount currencyCode }
            lineItems(first: 25) { edges { node { id title quantity variant { id title price sku } } } }
            createdAt
        }
    }
    """
    result = graphql_query(query, {"id": order_id})
    print(json.dumps(result["data"]["order"], indent=2))


def fulfill_order(order_id, tracking_number, carrier):
    order_num = order_id.split("/")[-1]
    if not order_num.isdigit():
        raise SystemExit(f"Non riesco a derivare l'id numerico dell'ordine da: {order_id}")
    order = rest_request("GET", f"/orders/{order_num}.json")
    line_items = order.get("order", {}).get("line_items", [])
    if not line_items:
        raise SystemExit("L'ordine non ha line items.")
    body = {
        "fulfillment": {
            "tracking_number": tracking_number,
            "tracking_company": carrier,
            "notify_customer": False,
            "line_items": [{"id": item["id"]} for item in line_items],
        }
    }
    result = rest_request("POST", f"/orders/{order_num}/fulfillments.json", body)
    print(json.dumps(result, indent=2))


def main():
    parser = argparse.ArgumentParser(description="Shopify Orders CLI")
    sub = parser.add_subparsers(dest="command")

    list_p = sub.add_parser("list")
    list_p.add_argument("--limit", type=int, default=10)
    list_p.add_argument("--status", default="any", choices=["any", "open", "closed", "cancelled", "paid", "unpaid", "refunded"])

    get_p = sub.add_parser("get")
    get_p.add_argument("--id", required=True)

    fulfill_p = sub.add_parser("fulfill")
    fulfill_p.add_argument("--id", required=True)
    fulfill_p.add_argument("--tracking-number", required=True)
    fulfill_p.add_argument("--carrier", default="GLS")

    args = parser.parse_args()
    if args.command == "list":
        list_orders(args.limit, args.status)
    elif args.command == "get":
        get_order(args.id)
    elif args.command == "fulfill":
        fulfill_order(args.id, args.tracking_number, args.carrier)
    else:
        parser.print_help()


if __name__ == "__main__":
    main()