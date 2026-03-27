"""Auth endpoint tests."""

from fastapi.testclient import TestClient


def test_login_with_correct_credentials(client: TestClient) -> None:
    resp = client.post(
        "/api/v1/auth/login",
        json={"email": "admin@test.com", "password": "testpassword123"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert "access_token" in data
    assert data["token_type"] == "bearer"
    assert data["user"]["email"] == "admin@test.com"
    assert data["user"]["role"] == "admin"
    # Refresh token should be set as cookie
    assert "refresh_token" in resp.cookies


def test_login_with_wrong_password(client: TestClient) -> None:
    resp = client.post(
        "/api/v1/auth/login",
        json={"email": "admin@test.com", "password": "wrong-password"},
    )
    assert resp.status_code == 401


def test_login_with_nonexistent_email(client: TestClient) -> None:
    resp = client.post(
        "/api/v1/auth/login",
        json={"email": "nobody@test.com", "password": "whatever123"},
    )
    assert resp.status_code == 401


def test_me_returns_current_user(client: TestClient, auth_headers: dict[str, str]) -> None:
    resp = client.get("/api/v1/auth/me", headers=auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["email"] == "admin@test.com"
    assert data["role"] == "admin"


def test_me_without_token_returns_401(client: TestClient) -> None:
    resp = client.get("/api/v1/auth/me")
    assert resp.status_code == 401


def test_refresh_returns_new_access_token(client: TestClient) -> None:
    # Login first to get refresh cookie
    login_resp = client.post(
        "/api/v1/auth/login",
        json={"email": "admin@test.com", "password": "testpassword123"},
    )
    assert login_resp.status_code == 200

    # Refresh endpoint reads cookie automatically via TestClient
    refresh_resp = client.post("/api/v1/auth/refresh")
    assert refresh_resp.status_code == 200
    assert "access_token" in refresh_resp.json()


def test_refresh_with_no_cookie_returns_401(client: TestClient) -> None:
    # Fresh client, no cookies
    resp = client.post("/api/v1/auth/refresh")
    # Should fail since no login was done (no cookie)
    assert resp.status_code == 401


def test_logout_revokes_session(client: TestClient) -> None:
    # Login
    login_resp = client.post(
        "/api/v1/auth/login",
        json={"email": "admin@test.com", "password": "testpassword123"},
    )
    assert login_resp.status_code == 200

    # Logout
    logout_resp = client.post("/api/v1/auth/logout")
    assert logout_resp.status_code == 204

    # Refresh should fail after logout (token revoked)
    refresh_resp = client.post("/api/v1/auth/refresh")
    assert refresh_resp.status_code == 401


def test_protected_endpoint_returns_401_without_token(client: TestClient) -> None:
    resp = client.get("/api/v1/files/feed")
    assert resp.status_code == 401


def test_protected_endpoint_returns_200_with_token(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    resp = client.get("/api/v1/files/feed", headers=auth_headers)
    assert resp.status_code == 200


def test_protected_endpoint_with_invalid_token(client: TestClient) -> None:
    resp = client.get(
        "/api/v1/files/feed",
        headers={"Authorization": "Bearer invalid-token-here"},
    )
    assert resp.status_code == 401


def test_register_requires_admin(client: TestClient, auth_headers: dict[str, str]) -> None:
    # Admin can register
    resp = client.post(
        "/api/v1/auth/register",
        json={"email": "viewer@test.com", "password": "viewerpass123", "role": "viewer"},
        headers=auth_headers,
    )
    assert resp.status_code == 201
    assert resp.json()["email"] == "viewer@test.com"

    # Login as the new viewer
    login_resp = client.post(
        "/api/v1/auth/login",
        json={"email": "viewer@test.com", "password": "viewerpass123"},
    )
    assert login_resp.status_code == 200
    viewer_token = login_resp.json()["access_token"]

    # Viewer cannot register new users
    resp2 = client.post(
        "/api/v1/auth/register",
        json={"email": "another@test.com", "password": "anotherpass123"},
        headers={"Authorization": f"Bearer {viewer_token}"},
    )
    assert resp2.status_code == 403
