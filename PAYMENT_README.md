## Payment Flow (Razorpay) – Overview, Issues, and Recommended Architecture

This document describes how the current Razorpay integration works across the **backend** and **frontend**, points out bugs and security problems, and shows how the architecture *should* look as per Razorpay best practices.

---

### 1. Current Implementation – Backend (`backend/`)

- **Config** (`src/config/rzpay.ts`)
  - Creates a Razorpay instance:
    - `key_id` and `key_secret` are **hard‑coded** in the source file.
- **Controller** (`src/controller/payment.controller.ts`)
  - Single `createOrder(req, res)` handler:
    - Reads `amount`, `currency`, and also `razorpay_signature`, `razorpay_payment_id`, `razorpay_order_id` from `req.body`.
    - Creates a Razorpay order with:
      - `amount: amount * 100`
      - `currency: currency || "INR"`.
    - Immediately creates a `Subscription` document with:
      - `userId` from `req.userId`
      - `amount`, `razorpay_signature`, `razorpay_order_id`, `razorpay_payment_id` from the request body (no signature verification).
    - Returns the Razorpay `order` object to the client.
- **Router** (`src/router/payment.router.ts`)
  - POST `/payment/create-order` → `createOrder`.
- **Model** (`src/model/subscription.model.ts`)
  - Stores `userId`, `amount`, `razorpay_signature`, `razorpay_order_id`, `razorpay_payment_id`.

**Key observations:**

- There is **only one** endpoint (`/create-order`) and it is used for both “create order” and (intended) “verify payment”.
- Razorpay signature is **never actually verified** on the server.
- It appears `req.userId` is assumed to exist, but the payment route does not show any explicit auth middleware.

---

### 2. Current Implementation – Frontend (`frontend/`)

- **Script include** (`index.html`)
  - Loads Razorpay Checkout script:
    - `<script src="https://checkout.razorpay.com/v1/checkout.js"></script>`.
- **Payment page** (`src/pages/Payment/Payment.tsx`)
  - `handlePayment`:
    - `POST http://localhost:3000/api/v1/payment/create-order` with JSON `{ amount: 200 }`.
    - Expects an order response (`data`) and calls `handlePaymentVerify(data)`.
  - `handlePaymentVerify(data)`:
    - Creates `options`:
      - `key: import.meta.env.VITE_RAZORPAY_KEY_ID`
      - `amount: 100` (**hard-coded**, not from backend)
      - `currency: "INR"`
      - `order_id: data.id` (from backend response)
      - `callback_url: "http://localhost:5173/dashboard"`
    - `handler(response)`:
      - Logs the Razorpay callback `response`.
      - Calls `axios.post("http://localhost:3000/api/v1/payment/create-order", { amount, razorpay_order_id, razorpay_payment_id, razorpay_signature })`.
      - Logs the server response.
  - Page is mounted at `/payment` (see `src/App.tsx`).

**Key observations:**

- Frontend uses **two calls** to `/payment/create-order`:
  1. Before checkout – to get an order.
  2. After successful payment – to (intended) “verify”/store payment using the same endpoint.
- Amount passed to Razorpay in the options is **not taken from the backend order**.
- `callback_url` just redirects to `/dashboard` regardless of whether the backend validates anything.

---

### 3. Bugs and Security Issues vs Razorpay Best Practices

**Backend**

- **Hard‑coded Razorpay credentials** (`key_id`, `key_secret`):
  - Sensitive data committed to the repo (serious secret‑management issue).
  - Should be read from environment variables (e.g. `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`).
- **No server‑side signature verification**:
  - Razorpay best practice: verify `razorpay_signature` using HMAC SHA256 of `order_id|payment_id` with `key_secret`.
  - Current code simply stores `razorpay_signature` and returns 200 without any verification.
  - This means a client could **forge a “successful payment”** by posting arbitrary values.
- **Single endpoint for both create and verify**:
  - `/payment/create-order` is used:
    - First time with `{ amount }` (no Razorpay fields).
    - Second time with Razorpay callback fields.
  - On the second call, the server again **creates a new Razorpay order** instead of verifying the existing one.
  - Subscription is stored using data coming directly from the client, not from a verified Razorpay payload.
- **Trusting client‑sent amount**:
  - Server uses `amount` from request body (`amount * 100` for order creation and stores `amount` in DB).
  - Client can modify the amount in the browser devtools and get a cheaper order.
  - Best practice: the **server** decides the amount based on a plan (e.g., “basic”, “pro”) or product ID, not raw client input.
- **Lack of explicit auth on payment route**:
  - `userId` is read from `req.userId`, but the router (`paymentRouter`) does not show an auth middleware.
  - If auth is not enforced, **anyone** could hit the endpoint and create fake subscriptions.
- **Missing error handling and logging around Razorpay errors**:
  - Only generic 500 with `'Error creating RazorPay order'`.
  - No differentiation between network errors, invalid params, etc.

**Frontend**

- **Hard‑coded amount in Razorpay options**:
  - `amount: 100` instead of using `data.amount` or `data.amount` from the backend order.
  - This can lead to a mismatch between backend order amount and the actual charged amount.
- **Reusing `/payment/create-order` for verification**:
  - After payment, handler posts to the same `create-order` endpoint; this is **not** how Razorpay verification should work.
- **No handling of failed payments or signature mismatch**:
  - Frontend simply logs response; it doesn’t check for server confirmation (e.g. a “payment_verified” flag).
- **No CSRF/authorization protection visible on the payment calls**:
  - If the backend relies on cookies / JWT, these requests should be made with the appropriate credentials and the backend must enforce them.

---

### 4. Recommended Architecture for a Secure Razorpay Integration

**Backend (API)**

1. **Configuration (`src/config/rzpay.ts`)**
  - Use environment variables:
    - `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`.
  - Never commit secrets to source control.
2. **Routes**
  - `POST /api/v1/payment/create-order`
    - **Auth‑protected** (must know `req.userId`).
    - Input: a **plan ID** or product identifier (not raw amount).
    - Server:
      - Looks up plan price.
      - Calls `razorpayInstance.orders.create({ amount: planAmountInPaise, currency: "INR" })`.
      - Stores a **Pending** payment/subscription record (e.g. `status: "PENDING"`, `orderId`, `userId`, `amount`).
      - Returns `{ id: order.id, amount: order.amount, currency: order.currency }` to frontend.
  - `POST /api/v1/payment/verify`
    - **Auth‑protected** or at least references a subscription/user record.
    - Input (from Razorpay handler on frontend):
      - `razorpay_order_id`, `razorpay_payment_id`, `razorpay_signature`.
    - Server:
      - Re‑computes signature using `crypto.createHmac("sha256", RAZORPAY_KEY_SECRET)`.
      - Compares computed signature with `razorpay_signature`.
      - If valid:
        - Marks the related subscription/payment as `SUCCESS`.
        - Optionally checks `amount` and `currency`.
      - If invalid:
        - Marks as `FAILED` / rejects the request.
      - Responds with `{ success: true/false, ... }`.
  - Optionally:
    - A **webhook** endpoint `/api/v1/payment/webhook` to handle asynchronous events from Razorpay and reconcile states.
3. **Data model (`subscription.model.ts`)**
  - Fields:
    - `userId`, `planId` (or product ref), `amount`, `currency`, `orderId`, `paymentId`, `status`, `razorpaySignature`, timestamps.
  - `status` enum: `"PENDING" | "SUCCESS" | "FAILED" | "CANCELLED"`.

**Frontend**

1. **Step 1 – Create order**
  - Call `POST /api/v1/payment/create-order` with a **planId** or similar.
  - Receive `{ id, amount, currency }`.
2. **Step 2 – Open Razorpay Checkout**
  - Build `options` using **only** data from the backend order:
    - `key: VITE_RAZORPAY_KEY_ID` (public key).
    - `amount: order.amount` (from backend).
    - `currency: order.currency`.
    - `order_id: order.id`.
    - `handler: (response) => { /* send to /verify */ }`.
  - Avoid hard‑coding amounts in the frontend.
3. **Step 3 – Verify payment**
  - In `handler`:
    - POST to `POST /api/v1/payment/verify` with `razorpay_order_id`, `razorpay_payment_id`, `razorpay_signature`.
  - Based on the server result:
    - Show success/failure UI.
    - Redirect only after backend confirms success (e.g. `if (res.data.success) navigate("/dashboard")`).
4. **Security considerations**
  - Ensure payment API routes require a valid authenticated user (JWT/cookie).
  - Do **not** trust `amount` or any “business” data from the client; compute or validate on server.
  - Keep `key_secret` strictly on server; expose only the public `key_id` to the frontend via env vars.

---

### 5. Summary of Key Fixes Needed

- Move Razorpay keys out of `rzpay.ts` into environment variables.
- Split the current `/payment/create-order` into two routes:
  - `/payment/create-order` (create + persist pending order).
  - `/payment/verify` (validate signature + mark success/fail).
- Implement proper HMAC signature verification using `key_secret`.
- Use **server‑defined amounts** (via plan or product ID), not raw amounts from client.
- Make sure payment routes are behind authentication and tied to `req.userId`.
- In the frontend:
  - Use the backend’s `order.amount` and `order.id` for Razorpay options.
  - Call a dedicated `/payment/verify` endpoint from the Razorpay `handler` and react to its result.

