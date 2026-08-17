import uuid


async def test_credit_payment_reduces_outstanding_balance(client, create_wholesale_customer, create_product_with_stock):
    unique = uuid.uuid4().hex[:8]
    async with client as ac:
        customer_id = await create_wholesale_customer(ac, unique, credit_limit=100.0)
        _, variant_id = await create_product_with_stock(ac, unique, stock=5, price=20.0)
        await ac.post(
            "/pos-sales",
            json={
                "customer_id": customer_id,
                "items": [{"variant_id": variant_id, "quantity": 2}],
                "payments": [{"method": "credit", "amount": 40.0}],
            },
        )

        payment_res = await ac.post(f"/customers/{customer_id}/credit-payments", json={"amount": 15.0})
        assert payment_res.status_code == 201, payment_res.text
        assert payment_res.json()["amount"] == -15.0

        customer_res = await ac.get(f"/customers/{customer_id}")
        assert customer_res.json()["outstanding_balance"] == 25.0


async def test_credit_payment_cannot_exceed_what_is_owed(client, create_wholesale_customer):
    unique = uuid.uuid4().hex[:8]
    async with client as ac:
        customer_id = await create_wholesale_customer(ac, unique, credit_limit=100.0)

        payment_res = await ac.post(f"/customers/{customer_id}/credit-payments", json={"amount": 15.0})
        assert payment_res.status_code == 409, payment_res.text


async def test_credit_adjustment_can_write_off_balance(client, create_wholesale_customer, create_product_with_stock):
    unique = uuid.uuid4().hex[:8]
    async with client as ac:
        customer_id = await create_wholesale_customer(ac, unique, credit_limit=100.0)
        _, variant_id = await create_product_with_stock(ac, unique, stock=5, price=20.0)
        await ac.post(
            "/pos-sales",
            json={
                "customer_id": customer_id,
                "items": [{"variant_id": variant_id, "quantity": 2}],
                "payments": [{"method": "credit", "amount": 40.0}],
            },
        )

        adjustment_res = await ac.post(
            f"/customers/{customer_id}/credit-adjustments",
            json={"amount": -40.0, "reason": "Bad debt write-off"},
        )
        assert adjustment_res.status_code == 201, adjustment_res.text

        customer_res = await ac.get(f"/customers/{customer_id}")
        assert customer_res.json()["outstanding_balance"] == 0.0


async def test_credit_ledger_lists_charges_and_payments_newest_first(
    client, create_wholesale_customer, create_product_with_stock
):
    unique = uuid.uuid4().hex[:8]
    async with client as ac:
        customer_id = await create_wholesale_customer(ac, unique, credit_limit=100.0)
        _, variant_id = await create_product_with_stock(ac, unique, stock=5, price=20.0)
        await ac.post(
            "/pos-sales",
            json={
                "customer_id": customer_id,
                "items": [{"variant_id": variant_id, "quantity": 1}],
                "payments": [{"method": "credit", "amount": 20.0}],
            },
        )
        await ac.post(f"/customers/{customer_id}/credit-payments", json={"amount": 5.0})

        ledger_res = await ac.get(f"/customers/{customer_id}/credit-ledger")
        assert ledger_res.status_code == 200, ledger_res.text
        entries = ledger_res.json()
        assert [e["entry_type"] for e in entries] == ["payment", "charge"]
        assert entries[0]["performed_by_name"] == "Test Owner"


async def test_is_wholesale_verified_reflects_type_and_approval_status(client):
    unique = uuid.uuid4().hex[:8]
    async with client as ac:
        create_res = await ac.post(
            "/customers",
            json={
                "full_name": "Pending Wholesale",
                "email": f"pending-{unique}@example.com",
                "customer_type": "wholesale",
            },
        )
        customer = create_res.json()
        assert customer["status"] == "pending"
        assert customer["is_wholesale_verified"] is False

        approve_res = await ac.post(f"/customers/{customer['id']}/status", json={"status": "approved"})
        assert approve_res.json()["is_wholesale_verified"] is True
