# API Style Guide

**Goal:** Ensure consistency, type safety, and standardized API responses.

- **Type Safety:** 
  - ❌ STRICTLY FORBIDDEN to use `any` or `unknown` (except for the `T` generic in the Base Response).
  - ✅ Explicitly define interfaces/types for Request Body, Params, and Query.
- **Error Handling:** 
  - ✅ ALL API routes/controllers MUST be wrapped in `try-catch` blocks.
  - ✅ Always return the EXACT HTTP Status Code (200, 201, 400, 401, 403, 404, 500).
- **Base Response Format:** MUST use the `successResponse` and `errorResponse` helpers.

| Status | HTTP Code | Returned JSON Structure |
| :--- | :--- | :--- |
| **Success** | `200`, `201` | `{ "message": string, "data": T, "statusCode": number }` |
| **Failure** | `4xx`, `5xx` | `{ "message": string, "statusCode": number }` |