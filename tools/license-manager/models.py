from dataclasses import dataclass, field


@dataclass
class License:
    id: str
    licenseKey: str
    groupId: str
    plan: str
    status: str
    createdAt: str
    expiresAt: str | None
    maxDevices: int
    activeDevices: list[str] = field(default_factory=list)

    @classmethod
    def from_dict(cls, d: dict) -> "License":
        return cls(
            id=d["id"],
            licenseKey=d["licenseKey"],
            groupId=d["groupId"],
            plan=d["plan"],
            status=d["status"],
            createdAt=d["createdAt"],
            expiresAt=d.get("expiresAt"),
            maxDevices=d["maxDevices"],
            activeDevices=d.get("activeDevices", []),
        )


@dataclass
class ClientGroup:
    id: str
    name: str
    ownerId: str
    licenseId: str
    storageBackendId: str
    fixedMasterDeviceId: str | None
    maxSyncFrequencyHours: float | None
    maxDatabaseSizeMb: float | None

    @classmethod
    def from_dict(cls, d: dict) -> "ClientGroup":
        return cls(
            id=d["id"],
            name=d["name"],
            ownerId=d["ownerId"],
            licenseId=d["licenseId"],
            storageBackendId=d.get("storageBackendId", "default"),
            fixedMasterDeviceId=d.get("fixedMasterDeviceId"),
            maxSyncFrequencyHours=d.get("maxSyncFrequencyHours"),
            maxDatabaseSizeMb=d.get("maxDatabaseSizeMb"),
        )


@dataclass
class DeviceRegistration:
    deviceId: str
    groupId: str
    licenseId: str
    deviceName: str
    registeredAt: str
    lastSeenAt: str
    lastSyncAt: str | None
    lastMarkerHash: str | None
    isFixedMaster: bool

    @classmethod
    def from_dict(cls, d: dict) -> "DeviceRegistration":
        return cls(
            deviceId=d["deviceId"],
            groupId=d["groupId"],
            licenseId=d["licenseId"],
            deviceName=d["deviceName"],
            registeredAt=d["registeredAt"],
            lastSeenAt=d["lastSeenAt"],
            lastSyncAt=d.get("lastSyncAt"),
            lastMarkerHash=d.get("lastMarkerHash"),
            isFixedMaster=d.get("isFixedMaster", False),
        )
