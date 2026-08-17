#!/usr/bin/env python3
"""Shopify Store Info CLI — display store information (Admin API sanity check)."""

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
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read())


def shop_info():
    query = """
    query {
        shop {
            name
            email
            primaryDomain { host }
            plan { name shopifyPlus }
            billingAddress { country }
        }
    }
    """
    result = graphql_query(query)
    shop = result["data"]["shop"]
    print(f"Nome: {shop['name']}")
    print(f"Email: {shop['email']}")
    print(f"Dominio: {shop['primaryDomain']['host']}")
    print(f"Plan: {shop['plan']['name']} (Plus: {shop['plan']['shopifyPlus']})")
    print(f"Paese: {shop['billingAddress']['country']}")


if __name__ == "__main__":
    shop_info()