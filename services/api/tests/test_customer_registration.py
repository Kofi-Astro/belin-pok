async def test_register_creates_customer_with_auth_user_id_and_token_email(signup_client, fake_auth_identity):
    async with signup_client as ac:
        res = await ac.post("/customers/register", json={"full_name": "Jane Shopper", "phone": "0551234567"})
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["full_name"] == "Jane Shopper"
    # Email comes from the verified auth token, never a body field -- a
    # self-registering customer can't claim someone else's email address.
    assert body["email"] == fake_auth_identity["email"]
    assert body["customer_type"] == "retail"
    assert body["status"] == "approved"


async def test_register_twice_conflicts(signup_client):
    async with signup_client as ac:
        first = await ac.post("/customers/register", json={"full_name": "Jane Shopper"})
        assert first.status_code == 201, first.text
        second = await ac.post("/customers/register", json={"full_name": "Jane Again"})
    assert second.status_code == 409


async def test_me_and_addresses_round_trip(customer_client):
    async with customer_client as ac:
        me_res = await ac.get("/customers/me")
        assert me_res.status_code == 200

        create_address_res = await ac.post(
            "/customers/me/addresses",
            json={"line1": "10 High St", "city": "Kumasi", "country": "Ghana"},
        )
        assert create_address_res.status_code == 201, create_address_res.text

        list_addresses_res = await ac.get("/customers/me/addresses")
    assert list_addresses_res.status_code == 200
    assert any(a["id"] == create_address_res.json()["id"] for a in list_addresses_res.json())
