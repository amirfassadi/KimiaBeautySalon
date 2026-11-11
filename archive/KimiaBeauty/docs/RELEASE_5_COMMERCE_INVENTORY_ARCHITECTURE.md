# Kimia Beauty — Release 5 Commerce and Inventory Architecture

**Status:** Release 5 Architecture Addendum  
**Repository:** KimiaBeauty

## Purpose

Define how Kimia Beauty adds product sales and stock tracking while preserving the distinction between Commerce, Inventory, Finance, and the product UI.

## Composition

```text
SmartCoreBusiness
    ↓
COMMERCE capability activated
    ↓
SmartCoreBusinessCapability.Commerce
    Product / Order
    ↓
SmartCoreInventory
    Stock / StockMovement
    ↓
SmartCoreFinance
    Payment
    ↓
KimiaBeauty
    Commerce UI / Admin / Orchestration
```

## Commerce vs Inventory

```text
Commerce asks:
What product is offered?
What did the customer order?
What was sold?

Inventory asks:
How many physical units exist?
Where are they?
Why did stock increase/decrease?
```

These must remain separate.

## Initial Kimia Use Case

Examples:

- shampoo
- hair serum
- skin-care product
- beauty accessory

Kimia may sell a Product independently or alongside a Service.

## Service + Product Composition

Future flow may support:

```text
Appointment
+ recommended Product
→ combined customer checkout experience
```

This does not mean Service and Product become the same domain model.

## Inventory Need

Once Kimia performs real product sales with physical stock, a dedicated Inventory capability becomes required.

Minimum Inventory responsibilities:

- StockItem / stock identity
- quantity on hand
- StockMovement
- adjustment
- sale decrement
- return increment
- location/warehouse reference if needed

## Finance

Payment remains in SmartCoreFinance.

Order/Sale owns why an amount is due.
Finance owns the payment truth.

## Multilingual

Product content uses Commerce translations.
Inventory remains mostly locale-independent.
User-facing stock/status labels are localized in UI.

## Release 5 Non-Goals

- full ERP
- supplier/purchasing workflow
- multi-warehouse optimization
- marketplace
- shipping/logistics platform
- tax engine
- complex promotions
- loyalty

## Extraction Rule

Commerce remains in SmartCoreBusinessCapability.

Inventory should be a separate SmartCore capability/repository because stock semantics are reusable across Commerce, Manufacturing, Supply Chain, Maintenance, and other domains.

---

> Sell through Commerce. Track physical stock through Inventory.
