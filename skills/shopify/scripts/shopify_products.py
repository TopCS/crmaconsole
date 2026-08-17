#!/usr/bin/env python3
"""Shopify Products CLI — list, get, create, update, delete, search (Admin API)."""

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
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        raise SystemExit(f"HTTP {e.code}: {e.read().decode()}") from e


def list_products(limit=10):
    query = """
    query($first: Int!) {
        products(first: $first) {
            edges {
                node {
                    id title handle status
                    priceRange { minVariantPrice { amount currencyCode } }
                }
            }
        }
    }
    """
    result = graphql_query(query, {"first": limit})
    for edge in result["data"]["products"]["edges"]:
        p = edge["node"]
        price = p["priceRange"]["minVariantPrice"]["amount"]
        print(f"{p['id']} | {p['title']} | ${price} | {p['status']}")


def get_product(product_id):
    query = """
    query($id: ID!) {
        product(id: $id) {
            id title handle description status vendor productType tags
            variants(first: 25) { edges { node { id title price sku inventoryQuantity } } }
        }
    }
    """
    result = graphql_query(query, {"id": product_id})
    print(json.dumps(result["data"]["product"], indent=2))


def create_product(file_path):
    with open(file_path) as f:
        product_data = json.load(f)
    query = """
    mutation($input: ProductInput!) {
        productCreate(input: $input) {
            product { id title }
            userErrors { field message }
        }
    }
    """
    result = graphql_query(query, {"input": product_data})
    print(json.dumps(result["data"]["productCreate"], indent=2))


def update_product(product_id, file_path):
    with open(file_path) as f:
        update_data = json.load(f)
    update_data["id"] = product_id
    query = """
    mutation($input: ProductInput!) {
        productUpdate(input: $input) {
            product { id title }
            userErrors { field message }
        }
    }
    """
    result = graphql_query(query, {"input": update_data})
    print(json.dumps(result["data"]["productUpdate"], indent=2))


def delete_product(product_id):
    query = """
    mutation($id: ID!) {
        productDelete(id: $id) {
            deletedProductId
            userErrors { field message }
        }
    }
    """
    result = graphql_query(query, {"id": product_id})
    print(json.dumps(result["data"]["productDelete"], indent=2))


def search_products(search_query):
    query = """
    query($query: String!) {
        products(first: 20, query: $query) {
            edges {
                node {
                    id title handle status
                    priceRange { minVariantPrice { amount } }
                    variants(first: 5) { edges { node { sku } } }
                }
            }
        }
    }
    """
    result = graphql_query(query, {"query": search_query})
    for edge in result["data"]["products"]["edges"]:
        p = edge["node"]
        price = p["priceRange"]["minVariantPrice"]["amount"]
        print(f"{p['id']} | {p['title']} | ${price} | {p['status']}")


def main():
    parser = argparse.ArgumentParser(description="Shopify Products CLI")
    sub = parser.add_subparsers(dest="command")

    list_p = sub.add_parser("list")
    list_p.add_argument("--limit", type=int, default=10)

    get_p = sub.add_parser("get")
    get_p.add_argument("--id", required=True)

    create_p = sub.add_parser("create")
    create_p.add_argument("--file", required=True)

    update_p = sub.add_parser("update")
    update_p.add_argument("--id", required=True)
    update_p.add_argument("--file", required=True)

    delete_p = sub.add_parser("delete")
    delete_p.add_argument("--id", required=True)

    search_p = sub.add_parser("search")
    search_p.add_argument("--query", required=True)

    args = parser.parse_args()
    if args.command == "list":
        list_products(args.limit)
    elif args.command == "get":
        get_product(args.id)
    elif args.command == "create":
        create_product(args.file)
    elif args.command == "update":
        update_product(args.id, args.file)
    elif args.command == "delete":
        delete_product(args.id)
    elif args.command == "search":
        search_products(args.query)
    else:
        parser.print_help()


if __name__ == "__main__":
    main()