# Kimia Beauty — Release 4 Operations Architecture

**Status:** Release 4 Architecture Addendum  
**Repository:** KimiaBeauty

## Purpose

Define ownership boundaries for Customer history, operational reporting, staff commission, and richer administration without turning KimiaBeauty into a new platform monolith.

## Core Principle

Release 4 adds operational intelligence and business-specific workflow on top of already-owned domain truth.

It must prefer:

- references
- read models
- projections
- product-specific policies

over duplicating authoritative data.

---

## 1. Customer Relationship

A customer remains a Person owned by SmartCoreIdentity.

The generic fact that a Person has a relationship with Kimia may be represented by SmartCoreBusiness as:

```text
BusinessPersonRelationship
- businessId
- personId
- relationshipType = CUSTOMER
- status
```

This is optional for the first booking flow and can be created when a real customer relationship begins.

### Kimia-specific Customer Profile

Salon-specific customer data may live in KimiaBeauty initially:

```text
KimiaCustomerProfile
- businessPersonRelationshipId
- preferredLocale?
- customerNote?
- preferences?
- createdAt
- updatedAt
```

This profile must not duplicate Person identity fields.

If customer relationship/CRM semantics later become reusable across products, they may be extracted into a dedicated shared capability.

---

## 2. Customer History

Customer history is primarily a projection, not a new source of truth.

Conceptually:

```text
Customer History
=
Appointments
+
Services
+
Payments
+
future Commerce activity
```

KimiaBeauty may expose a read model such as:

```text
CustomerHistoryView
- upcomingAppointments[]
- pastAppointments[]
- servicesReceived[]
- paymentSummary[]
```

The authoritative records remain in their owning modules.

Do not copy full Appointment/Payment history into a second customer-history table unless a deliberate projection/read-model architecture is adopted.

---

## 3. Reporting

Release 4 reporting is product-level operational reporting.

Initial reports may include:

- appointments per day/month
- completed appointments
- cancellations
- no-shows
- revenue by period
- revenue by Service
- revenue by Provider
- provider utilization
- repeat customer count

### Ownership

KimiaBeauty owns report definitions and product-facing projections for the Kimia use case.

Source truth remains:

```text
Appointment → KimiaBeauty
Reservation → SmartCoreReservation
Payment → SmartCoreFinance
Service → SmartCoreBusinessCapability
Provider relationship → SmartCoreBusiness
```

If analytics/reporting becomes reusable across multiple SmartCore products, introduce a future SmartCoreAnalytics capability rather than moving raw ownership.

---

## 4. Staff Commission

Commission is not Identity and not generic Payment truth.

For Kimia Release 4, commission rules remain product/business policy.

Candidate conceptual model:

```text
StaffCommissionPolicy
- businessId
- providerRelationshipId?
- serviceId?
- calculationType
- value
- effectiveFrom
- effectiveTo?
- status
```

Candidate calculation types:

```text
PERCENTAGE
FIXED_PER_SERVICE
```

Only the minimum rule actually used by Kimia should be implemented.

### Commission Calculation

```text
Completed Appointment
+
eligible financial amount
+
Commission Policy
=
Commission Accrual
```

Candidate product-owned record:

```text
CommissionAccrual
- appointmentId
- providerRelationshipId
- basisAmount
- commissionAmount
- currency
- status
```

### Finance Boundary

Kimia/product policy determines:

> how much commission is owed and why.

SmartCoreFinance may later execute:

- settlement
- payout
- ledger entries

Finance does not decide the commission formula.

---

## 5. Richer Admin

KimiaBeauty owns the admin product experience.

Release 4 admin may include:

- customer list
- customer profile/history
- appointment filters
- payment overview
- operational reports
- commission configuration
- commission accrual view
- staff performance view

Admin UI does not create new domain ownership.

It calls the relevant module APIs/read models.

---

## 6. Multilingual Requirements

Release 4 must preserve the multilingual baseline.

- customer-facing labels are localized;
- report titles/labels are localized by UI;
- financial amounts remain canonical Money values;
- commission type/status values remain canonical;
- customer preferred locale may be stored as a locale key, not localized text;
- free-text notes are user-authored content and are not automatically treated as translation resources.

---

## 7. Data Ownership Summary

```text
Person
→ SmartCoreIdentity

Business ↔ Person relationship
→ SmartCoreBusiness

Service
→ SmartCoreBusinessCapability.Service

Appointment
→ KimiaBeauty (current MVP boundary)

Reservation
→ SmartCoreReservation

Payment
→ SmartCoreFinance

Customer salon-specific profile
→ KimiaBeauty initially

Reports/read models
→ KimiaBeauty initially

Commission policy/accrual
→ KimiaBeauty initially

Commission payout/settlement
→ SmartCoreFinance when introduced
```

---

## 8. Future Extraction Triggers

### CRM / Customer Capability

Consider extraction when multiple products need reusable:

- business-customer profiles
- preferences
- customer segmentation
- notes
- loyalty/relationship lifecycle

### Analytics

Consider SmartCoreAnalytics when multiple products need:

- shared metrics
- reusable dimensions/measures
- common event ingestion
- dashboards across domains

### Workforce / Compensation

Consider SmartCoreWorkforce or a Compensation capability when multiple products need:

- employment
- compensation policies
- commissions
- payroll integration
- leave/contracts

Until reuse is proven, keep these product-specific and well-bounded.

---

## 9. Release 4 Non-Goals

- full CRM platform
- payroll
- tax calculation
- accounting suite
- BI warehouse
- loyalty program
- marketing automation
- complex commission tiers
- partner profit sharing
- chair rental
- employee contracts

---

## 10. Architecture Constraints

1. Customer history is a projection over authoritative sources.
2. Reports do not become new transaction sources of truth.
3. Commission formula belongs to business/product policy.
4. Finance executes monetary truth; it does not invent compensation policy.
5. Admin UI owns no reusable domain truth.
6. Extraction into new SmartCore repos requires demonstrated cross-product reuse.

---

> Release 4 adds operational intelligence without redistributing core domain ownership.
