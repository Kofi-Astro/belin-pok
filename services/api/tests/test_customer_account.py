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
