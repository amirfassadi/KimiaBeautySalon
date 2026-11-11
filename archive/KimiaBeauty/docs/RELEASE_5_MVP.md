# Kimia Beauty — Release 5 MVP

**Status:** MVP Delivery Scope  
**Product:** KimiaBeauty

## Goal

Allow Kimia Beauty to sell physical products and track basic stock.

## Phase 5A — Product Catalog

- activate COMMERCE capability
- product categories
- products
- multilingual names/descriptions
- price
- public product listing/detail

This phase can ship before stock tracking if Kimia only needs product presentation.

## Phase 5B — Simple Sale

- create Order
- add products/quantities
- calculate total
- create PaymentIntent
- payment success/failure
- mark Order paid/completed

## Phase 5C — Basic Inventory

Once physical sales are enabled:

- stock quantity
- stock movement
- decrement after valid sale
- increment on supported return/manual receipt
- admin stock view
- basic adjustment with reason

## Minimum Admin

- manage product categories
- manage products/translations
- activate/deactivate products
- view orders
- view payment state
- view stock
- perform authorized stock adjustment

## Multilingual Requirements

- Product and category content multilingual;
- locale fallback through Business.defaultLocale;
- order/payment/inventory canonical states localized only in UI.

## Definition of Done

Release 5 is complete when Kimia can:

```text
publish a multilingual product,
sell it through an Order,
take payment through SmartCoreFinance,
and—when inventory tracking is enabled—reflect the physical stock change exactly once.
```

## Deferred

- supplier purchasing
- advanced returns
- multiple warehouses
- promotions
- loyalty
- subscriptions
- marketplace
