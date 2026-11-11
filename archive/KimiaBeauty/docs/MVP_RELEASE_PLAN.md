# KimiaBeauty — Product MVP Plan

**Status:** MVP Delivery Plan

## Release 1 — Go Live

Goal: put the real multilingual Kimia website online quickly.

Includes:
- register/login
- public Business profile
- multilingual service categories
- multilingual services
- duration and price
- public pages
- locale selection/fallback

Dependencies:
- SmartCoreIdentity
- SmartCoreBusiness
- SmartCoreBusinessCapability / Service

## Release 2 — Appointment Booking

Includes:
- provider/staff selection
- working schedules
- date exceptions
- availability slots
- reservation
- cancel/reschedule
- appointment status

Dependencies:
- SmartCoreScheduling
- SmartCoreReservation
- provider/staff relationship model

## Release 3 — Payment and Communication

Includes:
- PaymentIntent
- payment/deposit
- payment result
- SMS confirmation
- cancellation message
- reminder
- minimal admin operations

Dependencies:
- SmartCoreFinance
- SmartCoreCommunication

## Release 4 — Business Operations

Includes when needed:
- customer history
- operational reports
- no-show handling
- staff commissions
- richer admin workflows

## Release 5 — Commerce

Includes when needed:
- products
- sales/orders
- inventory
- service/product cross-sell

## Definition of MVP Discipline

For every dependency:
- implement only what the current release requires;
- preserve the module's long-term architectural path;
- do not pull future features into current delivery;
- do not duplicate domain truth in KimiaBeauty.

---

> Ship useful product slices while preserving reusable module boundaries.
