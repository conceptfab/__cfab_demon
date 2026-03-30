from PyQt6.QtWidgets import (
    QApplication,
    QComboBox,
    QDateEdit,
    QDialog,
    QDialogButtonBox,
    QFormLayout,
    QGroupBox,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QMessageBox,
    QPushButton,
    QSpinBox,
    QVBoxLayout,
    QCheckBox,
)
from PyQt6.QtCore import QDate

from api_client import ApiClient, ApiError
from models import ClientGroup, License

PLANS = ["free", "starter", "pro", "enterprise"]
STATUSES = ["active", "trial", "expired", "suspended", "revoked"]
PLAN_MAX_DEVICES = {"free": 2, "starter": 5, "pro": 20, "enterprise": 9999}


class CreateLicenseDialog(QDialog):
    def __init__(self, client: ApiClient, groups: list[ClientGroup], parent=None):
        super().__init__(parent)
        self.client = client
        self.groups = groups
        self.created_license: License | None = None
        self.setWindowTitle("Create License")
        self.setMinimumWidth(400)
        self._build_ui()

    def _build_ui(self):
        layout = QVBoxLayout(self)
        form = QFormLayout()

        self.plan_combo = QComboBox()
        self.plan_combo.addItems(PLANS)
        self.plan_combo.currentTextChanged.connect(self._on_plan_changed)
        form.addRow("Plan:", self.plan_combo)

        self.devices_spin = QSpinBox()
        self.devices_spin.setRange(1, 9999)
        self.devices_spin.setValue(2)
        form.addRow("Max Devices:", self.devices_spin)

        self.group_combo = QComboBox()
        self.group_combo.addItem("(new group)", "")
        for g in self.groups:
            self.group_combo.addItem(g.name, g.id)
        form.addRow("Group:", self.group_combo)

        self.group_name_input = QLineEdit()
        self.group_name_input.setPlaceholderText("New group name")
        form.addRow("Group Name:", self.group_name_input)

        self.owner_input = QLineEdit()
        self.owner_input.setPlaceholderText("Owner ID (optional)")
        form.addRow("Owner ID:", self.owner_input)

        self.has_expiry = QCheckBox("Set expiry date")
        form.addRow("", self.has_expiry)

        self.expiry_date = QDateEdit()
        self.expiry_date.setCalendarPopup(True)
        self.expiry_date.setDate(QDate.currentDate().addYears(1))
        self.expiry_date.setEnabled(False)
        self.has_expiry.toggled.connect(self.expiry_date.setEnabled)
        form.addRow("Expires At:", self.expiry_date)

        layout.addLayout(form)

        self.result_group = QGroupBox("Generated License Key")
        self.result_group.setVisible(False)
        result_layout = QHBoxLayout(self.result_group)
        self.key_label = QLabel()
        self.key_label.setStyleSheet("font-size: 14px; font-weight: bold; font-family: monospace;")
        result_layout.addWidget(self.key_label)
        copy_btn = QPushButton("Copy")
        copy_btn.clicked.connect(self._copy_key)
        result_layout.addWidget(copy_btn)
        layout.addWidget(self.result_group)

        buttons = QDialogButtonBox()
        self.create_btn = buttons.addButton("Generate", QDialogButtonBox.ButtonRole.AcceptRole)
        self.create_btn.clicked.connect(self._create)
        buttons.addButton(QDialogButtonBox.StandardButton.Close)
        buttons.rejected.connect(self.reject)
        layout.addWidget(buttons)

    def _on_plan_changed(self, plan: str):
        self.devices_spin.setValue(PLAN_MAX_DEVICES.get(plan, 2))

    def _copy_key(self):
        if self.created_license:
            QApplication.clipboard().setText(self.created_license.licenseKey)

    def _create(self):
        try:
            group_id = self.group_combo.currentData()
            group_name = self.group_name_input.text().strip() if not group_id else None
            owner_id = self.owner_input.text().strip() or None
            expires_at = None
            if self.has_expiry.isChecked():
                expires_at = self.expiry_date.date().toString("yyyy-MM-dd") + "T23:59:59Z"

            self.created_license = self.client.create_license(
                plan=self.plan_combo.currentText(),
                group_id=group_id or None,
                group_name=group_name,
                owner_id=owner_id,
                max_devices=self.devices_spin.value(),
                expires_at=expires_at,
            )

            self.key_label.setText(self.created_license.licenseKey)
            self.result_group.setVisible(True)
            self.create_btn.setEnabled(False)

        except ApiError as e:
            QMessageBox.critical(self, "Error", f"{e.code}: {e}")
        except Exception as e:
            QMessageBox.critical(self, "Connection Error", str(e))


class EditLicenseDialog(QDialog):
    def __init__(self, client: ApiClient, license: License, parent=None):
        super().__init__(parent)
        self.client = client
        self.license = license
        self.updated = False
        self.setWindowTitle(f"Edit License \u2014 {license.licenseKey}")
        self.setMinimumWidth(400)
        self._build_ui()

    def _build_ui(self):
        layout = QVBoxLayout(self)
        form = QFormLayout()

        form.addRow("Key:", QLabel(self.license.licenseKey))

        self.plan_combo = QComboBox()
        self.plan_combo.addItems(PLANS)
        self.plan_combo.setCurrentText(self.license.plan)
        form.addRow("Plan:", self.plan_combo)

        self.status_combo = QComboBox()
        self.status_combo.addItems(STATUSES)
        self.status_combo.setCurrentText(self.license.status)
        form.addRow("Status:", self.status_combo)

        self.devices_spin = QSpinBox()
        self.devices_spin.setRange(1, 9999)
        self.devices_spin.setValue(self.license.maxDevices)
        form.addRow("Max Devices:", self.devices_spin)

        self.has_expiry = QCheckBox("Set expiry date")
        self.has_expiry.setChecked(self.license.expiresAt is not None)
        form.addRow("", self.has_expiry)

        self.expiry_date = QDateEdit()
        self.expiry_date.setCalendarPopup(True)
        if self.license.expiresAt:
            date_str = self.license.expiresAt[:10]
            self.expiry_date.setDate(QDate.fromString(date_str, "yyyy-MM-dd"))
        else:
            self.expiry_date.setDate(QDate.currentDate().addYears(1))
        self.expiry_date.setEnabled(self.has_expiry.isChecked())
        self.has_expiry.toggled.connect(self.expiry_date.setEnabled)
        form.addRow("Expires At:", self.expiry_date)

        layout.addLayout(form)

        buttons = QDialogButtonBox(
            QDialogButtonBox.StandardButton.Save | QDialogButtonBox.StandardButton.Cancel
        )
        buttons.accepted.connect(self._save)
        buttons.rejected.connect(self.reject)
        layout.addWidget(buttons)

    def _save(self):
        try:
            updates = {}
            if self.plan_combo.currentText() != self.license.plan:
                updates["plan"] = self.plan_combo.currentText()
            if self.status_combo.currentText() != self.license.status:
                updates["status"] = self.status_combo.currentText()
            if self.devices_spin.value() != self.license.maxDevices:
                updates["maxDevices"] = self.devices_spin.value()

            if self.has_expiry.isChecked():
                new_expiry = self.expiry_date.date().toString("yyyy-MM-dd") + "T23:59:59Z"
                if new_expiry != self.license.expiresAt:
                    updates["expiresAt"] = new_expiry
            elif self.license.expiresAt:
                updates["expiresAt"] = None

            if updates:
                self.client.update_license(self.license.id, updates)
                self.updated = True

            self.accept()
        except ApiError as e:
            QMessageBox.critical(self, "Error", f"{e.code}: {e}")
        except Exception as e:
            QMessageBox.critical(self, "Connection Error", str(e))
