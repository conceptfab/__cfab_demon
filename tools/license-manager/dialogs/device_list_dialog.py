from PyQt6.QtWidgets import (
    QDialog,
    QHBoxLayout,
    QHeaderView,
    QMessageBox,
    QPushButton,
    QTableWidget,
    QTableWidgetItem,
    QVBoxLayout,
)

from api_client import ApiClient, ApiError


class DeviceListDialog(QDialog):
    def __init__(self, client: ApiClient, license_id: str, parent=None):
        super().__init__(parent)
        self.client = client
        self.license_id = license_id
        self.setWindowTitle("Devices")
        self.setMinimumSize(700, 400)
        self._build_ui()
        self._load_devices()

    def _build_ui(self):
        layout = QVBoxLayout(self)

        self.table = QTableWidget()
        self.table.setColumnCount(6)
        self.table.setHorizontalHeaderLabels(
            ["Device ID", "Name", "Registered", "Last Seen", "Last Sync", "Master"]
        )
        self.table.horizontalHeader().setSectionResizeMode(QHeaderView.ResizeMode.Stretch)
        self.table.setSelectionBehavior(QTableWidget.SelectionBehavior.SelectRows)
        layout.addWidget(self.table)

        btn_layout = QHBoxLayout()
        self.deregister_btn = QPushButton("Deregister Selected")
        self.deregister_btn.clicked.connect(self._deregister)
        btn_layout.addWidget(self.deregister_btn)
        btn_layout.addStretch()
        close_btn = QPushButton("Close")
        close_btn.clicked.connect(self.accept)
        btn_layout.addWidget(close_btn)
        layout.addLayout(btn_layout)

    def _load_devices(self):
        try:
            devices = self.client.list_devices(self.license_id)
            self.table.setRowCount(len(devices))
            for row, d in enumerate(devices):
                self.table.setItem(row, 0, QTableWidgetItem(d.deviceId))
                self.table.setItem(row, 1, QTableWidgetItem(d.deviceName))
                self.table.setItem(row, 2, QTableWidgetItem(d.registeredAt[:10]))
                self.table.setItem(row, 3, QTableWidgetItem(d.lastSeenAt[:10]))
                self.table.setItem(row, 4, QTableWidgetItem(d.lastSyncAt[:10] if d.lastSyncAt else "\u2014"))
                self.table.setItem(row, 5, QTableWidgetItem("Yes" if d.isFixedMaster else "No"))
        except ApiError as e:
            QMessageBox.critical(self, "Error", f"{e.code}: {e}")
        except Exception as e:
            QMessageBox.critical(self, "Connection Error", str(e))

    def _deregister(self):
        row = self.table.currentRow()
        if row < 0:
            return
        device_id = self.table.item(row, 0).text()
        reply = QMessageBox.question(
            self,
            "Confirm",
            f"Deregister device {device_id}?",
            QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
        )
        if reply == QMessageBox.StandardButton.Yes:
            try:
                self.client.deregister_device(self.license_id, device_id)
                self._load_devices()
            except ApiError as e:
                QMessageBox.critical(self, "Error", f"{e.code}: {e}")
            except Exception as e:
                QMessageBox.critical(self, "Connection Error", str(e))
