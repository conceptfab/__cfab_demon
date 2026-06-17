import requests
from models import ClientGroup, DeviceRegistration, License


class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str):
        super().__init__(message)
        self.status = status
        self.code = code


class ApiClient:
    def __init__(self, server_url: str, admin_token: str):
        self.base_url = server_url.rstrip("/")
        self.session = requests.Session()
        self.session.headers["Authorization"] = f"Bearer {admin_token}"
        self.session.headers["Content-Type"] = "application/json"
        self.timeout = 10

    def _request(self, method: str, path: str, json_data: dict | None = None) -> dict:
        url = f"{self.base_url}{path}"
        resp = self.session.request(method, url, json=json_data, timeout=self.timeout)
        data = resp.json()
        if not data.get("ok"):
            raise ApiError(
                status=resp.status_code,
                code=data.get("code", "unknown"),
                message=data.get("error", "Unknown error"),
            )
        return data

    def list_licenses(self) -> list[License]:
        data = self._request("GET", "/api/admin/license")
        return [License.from_dict(l) for l in data["licenses"]]

    def get_license(self, license_id: str) -> License:
        data = self._request("GET", f"/api/admin/license/{license_id}")
        return License.from_dict(data["license"])

    def create_license(
        self,
        plan: str,
        group_id: str | None = None,
        group_name: str | None = None,
        owner_id: str | None = None,
        max_devices: int | None = None,
        expires_at: str | None = None,
    ) -> License:
        body: dict = {"plan": plan}
        if group_id:
            body["groupId"] = group_id
        if group_name:
            body["groupName"] = group_name
        if owner_id:
            body["ownerId"] = owner_id
        if max_devices is not None:
            body["maxDevices"] = max_devices
        if expires_at is not None:
            body["expiresAt"] = expires_at
        data = self._request("POST", "/api/admin/license", body)
        return License.from_dict(data["license"])

    def update_license(self, license_id: str, updates: dict) -> License:
        data = self._request("PATCH", f"/api/admin/license/{license_id}", updates)
        return License.from_dict(data["license"])

    def delete_license(self, license_id: str) -> bool:
        data = self._request("DELETE", f"/api/admin/license/{license_id}")
        return data.get("deleted", False)

    def list_devices(self, license_id: str) -> list[DeviceRegistration]:
        data = self._request("GET", f"/api/admin/license/{license_id}/devices")
        return [DeviceRegistration.from_dict(d) for d in data["devices"]]

    def deregister_device(self, license_id: str, device_id: str) -> bool:
        data = self._request(
            "DELETE", f"/api/admin/license/{license_id}/devices/{device_id}"
        )
        return data.get("deleted", False)

    def list_groups(self) -> list[ClientGroup]:
        data = self._request("GET", "/api/admin/group")
        return [ClientGroup.from_dict(g) for g in data["groups"]]

    def create_group(
        self,
        name: str,
        owner_id: str,
        license_id: str,
        storage_backend_id: str | None = None,
        fixed_master_device_id: str | None = None,
    ) -> ClientGroup:
        body: dict = {"name": name, "ownerId": owner_id, "licenseId": license_id}
        if storage_backend_id:
            body["storageBackendId"] = storage_backend_id
        if fixed_master_device_id is not None:
            body["fixedMasterDeviceId"] = fixed_master_device_id
        data = self._request("POST", "/api/admin/group", body)
        return ClientGroup.from_dict(data["group"])

    def update_group(self, group_id: str, updates: dict) -> ClientGroup:
        data = self._request("PATCH", f"/api/admin/group/{group_id}", updates)
        return ClientGroup.from_dict(data["group"])

    def test_connection(self) -> bool:
        try:
            self.list_licenses()
            return True
        except Exception:
            return False
