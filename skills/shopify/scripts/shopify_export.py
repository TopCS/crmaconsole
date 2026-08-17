#!/usr/bin/env python3
"""Shopify Export CLI — export products/orders to CSV or JSON (Admin API)."""

import argparse
import csv
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
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        raise SystemExit(f"HTTP {e.code}: {e.read().decode()}") from e


def write_csv(output_file, rows):
    if not rows:
        print(f"Exported 0 rows to {output_file}")
        return
    with open(output_file, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)
    print(f"Exported {len(rows)} rows to {output_file}")


def export_products(output_file, fmt="csv"):
    query = """
    query($first: Int!, $after: String) {
        products(first: $first, after: $after) {
            pageInfo { hasNextPage endCursor }
            edges {
                node {
                    id title handle status vendor productType tags
                    priceRange { minVariantPrice { amount currencyCode } }
                    createdAt updatedAt
                }
            }
        }
    }
    """
    all_products = []
    cursor = None
    while True:
        result = graphql_query(query, {"first": 50, "after": cursor})
        products = result["data"]["products"]
        for edge in products["edges"]:
            node = edge["node"]
            all_products.append({
                "id": node["id"],
                "title": node["title"],
                "handle": node["handle"],
                "status": node["status"],
                "vendor": node["vendor"],
                "productType": node["productType"],
                "tags": ", ".join(node["tags"]) if node["tags"] else "",
                "price": node["priceRange"]["minVariantPrice"]["amount"],
                "currency": node["priceRange"]["minVariantPrice"]["currencyCode"],
                "createdAt": node["createdAt"],
                "updatedAt": node["updatedAt"],
            })
        if not products["pageInfo"]["hasNextPage"]:
            break
        cursor = products["pageInfo"]["endCursor"]

    if fmt == "csv":
        write_csv(output_file, all_products)
    else:
        print(json.dumps(all_products, indent=2))


def export_orders(output_file, fmt="csv", date_from=None, date_to=None, status=None):
    query = """
    query($first: Int!, $after: String, $query: String!) {
        orders(first: $first, after: $after, query: $query, sortKey: CREATED_AT, reverse: true) {
            pageInfo { hasNextPage endCursor }
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
    conditions = []
    if date_from:
        conditions.append(f"created_at>={date_from}")
    if date_to:
        conditions.append(f"created_at<={date_to}")
    if status:
        conditions.append(f"financial_status:{status}")
    q = " ".join(conditions)

    all_orders = []
    cursor = None
    while True:
        result = graphql_query(query, {"first": 50, "after": cursor, "query": q})
        orders = result["data"]["orders"]
        for edge in orders["edges"]:
            node = edge["node"]
            all_orders.append({
                "orderNumber": node["orderNumber"],
                "name": node["name"],
                "email": node["email"],
                "financialStatus": node["financialStatus"],
                "fulfillmentStatus": node["fulfillmentStatus"],
                "total": node["totalPrice"]["amount"],
                "currency": node["totalPrice"]["currencyCode"],
                "createdAt": node["createdAt"],
            })
        if not orders["pageInfo"]["hasNextPage"]:
            break
        cursor = orders["pageInfo"]["endCursor"]

    if fmt == "csv":
        write_csv(output_file, all_orders)
    else:
        print(json.dumps(all_orders, indent=2))


def main():
    parser = argparse.ArgumentParser(description="Shopify Export CLI")
    sub = parser.add_subparsers(dest="command")

    prod_p = sub.add_parser("products")
    prod_p.add_argument("--format", default="csv", choices=["csv", "json"])
    prod_p.add_argument("--output", default="products.csv")

    orders_p = sub.add_parser("orders")
    orders_p.add_argument("--format", default="csv", choices=["csv", "json"])
    orders_p.add_argument("--output", default="orders.csv")
    orders_p.add_argument("--date-from", help="YYYY-MM-DD")
    orders_p.add_argument("--date-to", help="YYYY-MM-DD")
    orders_p.add_argument("--status", help="paid, unpaid, etc.")

    args = parser.parse_args()
    if args.command == "products":
        export_products(args.output, args.format)
    elif args.command == "orders":
        export_orders(args.output, args.format, args.date_from, args.date_to, args.status)
    else:
        parser.print_help()


if __name__ == "__main__":
    main()