from PyQt6.QtWidgets import (
    QApplication,
    QHBoxLayout,
    QHeaderView,
    QMainWindow,
    QMessageBox,
    QPushButton,
    QStatusBar,
    QTableWidget,
    QTableWidgetItem,
    QToolBar,
    QVBoxLayout,
    QWidget,
)
from PyQt6.QtGui import QAction
from PyQt6.QtCore import Qt

from api_client import ApiClient, ApiError
from config import AppConfig
from models import License, ClientGroup
from dialogs.license_dialog import CreateLicenseDialog, EditLicenseDialog
from dialogs.group_dialog import CreateGroupDialog
from dialogs.device_list_dialog import DeviceListDialog
from dialogs.settings_dialog import SettingsDialog


class MainWindow(QMainWindow):
    def __init__(self, config: AppConfig):
        super().__init__()
        self.config = config
        self.client: ApiClient | None = None
        self.licenses: list[License] = []
        self.groups: list[ClientGroup] = []

        self.setWindowTitle("TIMEFLOW License Manager")
        self.setMinimumSize(900, 500)

        self._build_toolbar()
        self._build_ui()
        self._build_statusbar()

        if config.is_configured():
            self._connect()
        else:
            self._show_settings()

    def _build_toolbar(self):
        toolbar = QToolBar("Main")
        toolbar.setMovable(False)
        self.addToolBar(toolbar)

        self.new_action = QAction("New License", self)
        self.new_action.triggered.connect(self._new_license)
        toolbar.addAction(self.new_action)

        self.edit_action = QAction("Edit", self)
        self.edit_action.triggered.connect(self._edit_license)
        toolbar.addAction(self.edit_action)

        self.delete_action = QAction("Delete", self)
        self.delete_action.triggered.connect(self._delete_license)
        toolbar.addAction(self.delete_action)

        self.devices_action = QAction("Devices", self)
        self.devices_action.triggered.connect(self._show_devices)
        toolbar.addAction(self.devices_action)

        toolbar.addSeparator()

        self.refresh_action = QAction("Refresh", self)
        self.refresh_action.triggered.connect(self._refresh)
        toolbar.addAction(self.refresh_action)

        self.settings_action = QAction("Settings", self)
        self.settings_action.triggered.connect(self._show_settings)
        toolbar.addAction(self.settings_action)

    def _build_ui(self):
        central = QWidget()
        self.setCentralWidget(central)
        layout = QVBoxLayout(central)

        self.table = QTableWidget()
        self.table.setColumnCount(7)
        self.table.setHorizontalHeaderLabels(
            ["License Key", "Plan", "Status", "Group", "Max Devices", "Active", "Expires"]
        )
        self.table.horizontalHeader().setSectionResizeMode(0, QHeaderView.ResizeMode.Stretch)
        self.table.setSelectionBehavior(QTableWidget.SelectionBehavior.SelectRows)
        self.table.setEditTriggers(QTableWidget.EditTrigger.NoEditTriggers)
        self.table.doubleClicked.connect(self._edit_license)
        layout.addWidget(self.table)

    def _build_statusbar(self):
        self.statusbar = QStatusBar()
        self.setStatusBar(self.statusbar)
        self.statusbar.showMessage("Not connected")

    def _connect(self):
        self.client = ApiClient(self.config.server_url, self.config.admin_token)
        self._refresh()

    def _refresh(self):
        if not self.client:
            return
        try:
            self.licenses = self.client.list_licenses()
            self.groups = self.client.list_groups()
            self._populate_table()
            self.statusbar.showMessage(
                f"Connected — {len(self.licenses)} licenses, {len(self.groups)} groups"
            )
        except ApiError as e:
            self.statusbar.showMessage(f"Error: {e.code}")
            if e.status == 401:
                QMessageBox.warning(self, "Auth Error", "Invalid admin token.")
                self._show_settings()
        except Exception as e:
            self.statusbar.showMessage("Connection failed")
            QMessageBox.critical(self, "Connection Error", str(e))

    def _populate_table(self):
        group_map = {g.id: g.name for g in self.groups}
        self.table.setRowCount(len(self.licenses))
        for row, lic in enumerate(self.licenses):
            self.table.setItem(row, 0, QTableWidgetItem(lic.licenseKey))
            self.table.setItem(row, 1, QTableWidgetItem(lic.plan))
            self.table.setItem(row, 2, QTableWidgetItem(lic.status))
            self.table.setItem(row, 3, QTableWidgetItem(group_map.get(lic.groupId, lic.groupId)))
            self.table.setItem(row, 4, QTableWidgetItem(str(lic.maxDevices)))
            self.table.setItem(row, 5, QTableWidgetItem(str(len(lic.activeDevices))))
            self.table.setItem(row, 6, QTableWidgetItem(lic.expiresAt[:10] if lic.expiresAt else "—"))

    def _selected_license(self) -> License | None:
        row = self.table.currentRow()
        if row < 0 or row >= len(self.licenses):
            return None
        return self.licenses[row]

    def _new_license(self):
        if not self.client:
            return
        dlg = CreateLicenseDialog(self.client, self.groups, self)
        dlg.exec()
        if dlg.created_license:
            self._refresh()

    def _edit_license(self):
        lic = self._selected_license()
        if not lic or not self.client:
            return
        dlg = EditLicenseDialog(self.client, lic, self)
        dlg.exec()
        if dlg.updated:
            self._refresh()

    def _delete_license(self):
        lic = self._selected_license()
        if not lic or not self.client:
            return
        reply = QMessageBox.question(
            self,
            "Confirm Delete",
            f"Delete license {lic.licenseKey}?\n\nThis will also remove all associated devices.",
            QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
        )
        if reply == QMessageBox.StandardButton.Yes:
            try:
                self.client.delete_license(lic.id)
                self._refresh()
            except Exception as e:
                QMessageBox.critical(self, "Error", str(e))

    def _show_devices(self):
        lic = self._selected_license()
        if not lic or not self.client:
            return
        dlg = DeviceListDialog(self.client, lic.id, self)
        dlg.exec()
        self._refresh()

    def _show_settings(self):
        dlg = SettingsDialog(self.config, self)
        if dlg.exec() == SettingsDialog.DialogCode.Accepted:
            self._connect()
