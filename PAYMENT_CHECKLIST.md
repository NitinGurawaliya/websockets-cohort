## Production Checklist for Razorpay Payment System (Single Plan)

Use this as a step‑by‑step checklist to take the current payment implementation to a **secure, production‑ready** state with **one subscription plan**.

---

### 1. Razorpay Account & Dashboard

- [ ] **Razorpay account set up**
  - [ ] Live mode enabled.
  - [ ] KYC and compliance completed.
- [ ] **API keys created**
  - [ ] Live `key_id` and `key_secret` generated.
  - [ ] Test and live keys clearly labeled and stored securely (e.g. password manager).
- [ ] **Webhook configured (optional but recommended)**
  - [ ] Webhook URL (e.g. `/api/v1/payment/webhook`) added in Razorpay dashboard.
  - [ ] Only required events selected (e.g. `payment.captured`, `payment.failed`).
  - [ ] Webhook secret stored as env var (e.g. `RAZORPAY_WEBHOOK_SECRET`).

---

### 2. Environment & Configuration (Backend)

- [ ] **No Razorpay secrets in code**
  - [ ] `backend/src/config/rzpay.ts` reads:
    - [ ] `process.env.RAZORPAY_KEY_ID`
    - [ ] `process.env.RAZORPAY_KEY_SECRET`
  - [ ] Test keys used in dev/stage; live keys only in prod.
- [ ] **Environment variables set correctly**
  - [ ] `RAZORPAY_KEY_ID`
  - [ ] `RAZORPAY_KEY_SECRET`
  - [ ] `BASE_URL` / `FRONTEND_URL` (for callback URLs, CORS).
  - [ ] Any DB connection strings, JWT secrets, etc.
- [ ] **Config sanity checks**
  - [ ] App fails fast (logs error and exits) if Razorpay env vars are missing in prod.

---

### 3. Single Plan Definition (Server‑Side)

Since there is **only one plan**, define it centrally on the server and **never let the client pick or send the raw amount**.

- [ ] **Plan defined in config or database**
  - [ ] Example config object:
    - [ ] `PLAN_ID = "single_plan"`
    - [ ] `PLAN_AMOUNT_INR = 200` (or your chosen amount).
    - [ ] `PLAN_AMOUNT_PAISE = PLAN_AMOUNT_INR * 100`.
  - [ ] Currency fixed to `"INR"`.
- [ ] **Plan selection in API**
  - [ ] `POST /payment/create-order`:
    - [ ] Does **not** accept `amount` from the client.
    - [ ] Uses the **single plan** amount from server config for every order.
  - [ ] `Subscription` or `Payment` record stores:
    - [ ] `planId` (`"single_plan"`).
    - [ ] `amount` and `currency` derived from plan, not client request.

---

### 4. Backend API Endpoints

#### 4.1 `POST /api/v1/payment/create-order`

- [ ] **Authentication**
  - [ ] Route protected by auth middleware (e.g. JWT) to ensure `req.userId` is valid.
- [ ] **Input**
  - [ ] Option A (simplest for single plan): no body (server always uses the same plan).
  - [ ] Option B: `{ planId: "single_plan" }` only, validated strictly.
- [ ] **Logic**
  - [ ] Resolve plan → `amountInPaise` and `currency`.
  - [ ] Call `razorpayInstance.orders.create({ amount, currency })`.
  - [ ] Create a **PENDING** subscription/payment document with:
    - [ ] `userId`
    - [ ] `planId` (single plan)
    - [ ] `orderId` (`order.id`)
    - [ ] `amount` and `currency`
    - [ ] `status: "PENDING"`
  - [ ] Return minimal data to frontend:
    - [ ] `id` (order id)
    - [ ] `amount`
    - [ ] `currency`
    - [ ] Any relevant notes if needed.

#### 4.2 `POST /api/v1/payment/verify`

- [ ] **Authentication**
  - [ ] Same auth middleware; ensures the user verifying is the same one who initiated the order.
- [ ] **Input**
  - [ ] `razorpay_order_id`
  - [ ] `razorpay_payment_id`
  - [ ] `razorpay_signature`
- [ ] **Signature verification**
  - [ ] Compute HMAC SHA256:
    - [ ] `expectedSignature = hmacSha256(orderId + "|" + paymentId, RAZORPAY_KEY_SECRET)`.
  - [ ] Compare `expectedSignature` with `razorpay_signature` from client.
- [ ] **On valid signature**
  - [ ] Find existing `PENDING` subscription/payment by `orderId` and `userId`.
  - [ ] Confirm amount and currency match the single plan (defense in depth).
  - [ ] Update record:
    - [ ] `paymentId`
    - [ ] `razorpaySignature`
    - [ ] `status: "SUCCESS"`
  - [ ] Grant features tied to subscription (e.g. mark user as `isSubscribed: true`).
  - [ ] Respond with `{ success: true, ... }`.
- [ ] **On invalid signature**
  - [ ] Update record:
    - [ ] `status: "FAILED"`
  - [ ] Respond with `{ success: false, error: "Invalid signature" }` and `4xx` status.

#### 4.3 (Optional) `POST /api/v1/payment/webhook`

- [ ] Validate Razorpay webhook signature using `RAZORPAY_WEBHOOK_SECRET`.
- [ ] Update payment/subscription status based on events (`payment.captured`, `payment.failed`).
- [ ] Ensure idempotent processing (ignore already‑processed events).

---

### 5. Database & Models

- [ ] **Subscription/Payment model includes**
  - [ ] `userId` (ref to User).
  - [ ] `planId` (for now constant `"single_plan"`).
  - [ ] `amount` and `currency`.
  - [ ] `orderId` (Razorpay).
  - [ ] `paymentId` (Razorpay).
  - [ ] `razorpaySignature`.
  - [ ] `status` enum: `"PENDING" | "SUCCESS" | "FAILED" | "CANCELLED"`.
  - [ ] `createdAt`, `updatedAt`.
- [ ] **Indexes**
  - [ ] Index on `userId`.
  - [ ] Index on `orderId`.
  - [ ] (Optional) Compound index on `{ userId, status }` for fast queries.

---

### 6. Frontend Flow

- [ ] **1. Create Order**
  - [ ] Call `POST /api/v1/payment/create-order` when user clicks “Pay”.
  - [ ] Use auth (JWT/cookie) so backend knows which user is paying.
  - [ ] Save the returned `order.id`, `amount`, `currency`.

- [ ] **2. Open Razorpay Checkout**
  - [ ] Construct Razorpay options:
    - [ ] `key: VITE_RAZORPAY_KEY_ID` (public key only).
    - [ ] `amount: order.amount` from backend.
    - [ ] `currency: order.currency`.
    - [ ] `order_id: order.id`.
    - [ ] `name`, `description`, `image` as desired.
    - [ ] `handler(response)`:
      - [ ] `POST /api/v1/payment/verify` with `razorpay_order_id`, `razorpay_payment_id`, `razorpay_signature`.
      - [ ] On success → show success UI and navigate (e.g. `/dashboard`).
      - [ ] On failure → show error and do **not** treat as paid.
  - [ ] Do **not** hard‑code `amount` in frontend; always use backend amount.

- [ ] **3. UI/UX**
  - [ ] Show loading state when creating order.
  - [ ] Disable button while payment is in progress.
  - [ ] Show clear success or failure messages after `/verify`.
  - [ ] On page load, fetch user subscription status to decide which UI to show (e.g. “Subscribed” vs “Subscribe Now”).

---

### 7. Security & Hardening

- [ ] **Transport security**
  - [ ] All frontend ↔ backend and backend ↔ Razorpay communication over HTTPS.
- [ ] **Secrets & tokens**
  - [ ] Razorpay `key_secret` only on server; never exposed in frontend bundle.
  - [ ] JWT secrets, DB passwords, webhook secrets all in env vars, not committed.
- [ ] **Input validation**
  - [ ] All payment endpoints validate input with a schema (e.g. Zod/Joi).
  - [ ] Reject unknown/extra fields in prod (strict mode).
- [ ] **Auth**
  - [ ] Payment routes require valid, non‑expired tokens.
  - [ ] Verify that the user who created the order is the same user verifying it.
- [ ] **Logging**
  - [ ] Log all payment attempts with:
    - [ ] `userId`, `orderId`, `paymentId`, `status`.
  - [ ] Do **not** log raw `key_secret` or full card details (Razorpay handles PCI).
- [ ] **Rate limiting**
  - [ ] Basic rate‑limiting on `/payment/create-order` and `/payment/verify` to reduce abuse.

---

### 8. Monitoring, Alerts, and Testing

- [ ] **Monitoring**
  - [ ] Application logs searchable (e.g. via a log aggregation service).
  - [ ] Dashboards for:
    - [ ] Count of `PENDING`, `SUCCESS`, `FAILED` payments.
    - [ ] Revenue per day.
- [ ] **Alerts**
  - [ ] Alert when:
    - [ ] Verification failures spike.
    - [ ] Webhook delivery failures occur frequently.
    - [ ] Application errors in payment routes exceed a threshold.

- [ ] **Testing**
  - [ ] End‑to‑end tests on **test** Razorpay keys:
    - [ ] Successful payment flow:
      - [ ] Order created → Razorpay test payment → `/verify` → subscription `SUCCESS`.
    - [ ] Failed/aborted payment:
      - [ ] Order created → user closes modal/cancels → remains `PENDING` or `FAILED`.
    - [ ] Tampered signature:
      - [ ] Manually change `razorpay_signature` and confirm `/verify` rejects it.
  - [ ] Manual tests with:
    - [ ] Slow network.
    - [ ] Duplicate `/verify` calls (idempotency).

---

### 9. Advanced / Nice‑to‑Have Improvements

- [ ] **Webhooks for extra safety**
  - [ ] Use Razorpay webhooks to reconcile any discrepancies with your DB.
  - [ ] Mark payments based on `payment.captured` events even if frontend flow fails.
- [ ] **Idempotent verification**
  - [ ] `/verify` should be safe to call multiple times:
    - [ ] If already `SUCCESS`, just return success without side effects.
- [ ] **Grace periods & renewals**
  - [ ] If you later add subscription renewal:
    - [ ] Track expiry dates.
    - [ ] Send reminders via email/push before expiration.
- [ ] **Feature flags**
  - [ ] Use flags to quickly disable new payment‑related features without redeploy.
- [ ] **Audit trail**
  - [ ] Keep a simple audit log of changes in subscription status for debugging.

---

### 10. Final Pre‑Production Checklist

- [ ] Test keys removed from prod config; live keys only.
- [ ] All payment code paths tested with Razorpay test mode.
- [ ] All secrets stored securely and not logged.
- [ ] Signature verification implemented and verified (including negative tests).
- [ ] Frontend never sends raw `amount`; uses server‑defined single plan.
- [ ] Payment routes protected by auth.
- [ ] Monitoring + logging in place for payments.
- [ ] Rollback plan in case of payment‑related deployment issues.

