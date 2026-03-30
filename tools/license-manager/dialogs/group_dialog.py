from PyQt6.QtWidgets import (
    QDialog,
    QDialogButtonBox,
    QFormLayout,
    QLineEdit,
    QMessageBox,
    QVBoxLayout,
)

from api_client import ApiClient, ApiError


class CreateGroupDialog(QDialog):
    def __init__(self, client: ApiClient, license_id: str, parent=None):
        super().__init__(parent)
        self.client = client
        self.license_id = license_id
        self.created = False
        self.setWindowTitle("Create Group")
        self.setMinimumWidth(350)
        self._build_ui()

    def _build_ui(self):
        layout = QVBoxLayout(self)
        form = QFormLayout()

        self.name_input = QLineEdit()
        self.name_input.setPlaceholderText("Group name")
        form.addRow("Name:", self.name_input)

        self.owner_input = QLineEdit()
        self.owner_input.setPlaceholderText("Owner user ID")
        form.addRow("Owner ID:", self.owner_input)

        self.master_input = QLineEdit()
        self.master_input.setPlaceholderText("(optional) fixed master device ID")
        form.addRow("Fixed Master:", self.master_input)

        layout.addLayout(form)

        buttons = QDialogButtonBox(
            QDialogButtonBox.StandardButton.Save | QDialogButtonBox.StandardButton.Cancel
        )
        buttons.accepted.connect(self._save)
        buttons.rejected.connect(self.reject)
        layout.addWidget(buttons)

    def _save(self):
        name = self.name_input.text().strip()
        owner = self.owner_input.text().strip()
        if not name or not owner:
            QMessageBox.warning(self, "Error", "Name and Owner ID are required.")
            return
        try:
            fixed_master = self.master_input.text().strip() or None
            self.client.create_group(
                name=name,
                owner_id=owner,
                license_id=self.license_id,
                fixed_master_device_id=fixed_master,
            )
            self.created = True
            self.accept()
        except ApiError as e:
            QMessageBox.critical(self, "Error", f"{e.code}: {e}")
        except Exception as e:
            QMessageBox.critical(self, "Connection Error", str(e))
