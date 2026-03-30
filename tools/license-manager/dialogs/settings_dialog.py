from PyQt6.QtWidgets import (
    QDialog,
    QDialogButtonBox,
    QFormLayout,
    QLabel,
    QLineEdit,
    QMessageBox,
    QVBoxLayout,
)

from api_client import ApiClient
from config import AppConfig


class SettingsDialog(QDialog):
    def __init__(self, config: AppConfig, parent=None):
        super().__init__(parent)
        self.config = config
        self.setWindowTitle("TIMEFLOW Admin — Settings")
        self.setMinimumWidth(450)
        self._build_ui()

    def _build_ui(self):
        layout = QVBoxLayout(self)

        form = QFormLayout()
        self.url_input = QLineEdit(self.config.server_url)
        self.url_input.setPlaceholderText("https://your-server.com")
        form.addRow("Server URL:", self.url_input)

        self.token_input = QLineEdit(self.config.admin_token)
        self.token_input.setEchoMode(QLineEdit.EchoMode.Password)
        self.token_input.setPlaceholderText("admin token")
        form.addRow("Admin Token:", self.token_input)

        layout.addLayout(form)

        self.status_label = QLabel("")
        layout.addWidget(self.status_label)

        buttons = QDialogButtonBox()
        self.test_btn = buttons.addButton("Test Connection", QDialogButtonBox.ButtonRole.ActionRole)
        self.test_btn.clicked.connect(self._test_connection)
        buttons.addButton(QDialogButtonBox.StandardButton.Save)
        buttons.addButton(QDialogButtonBox.StandardButton.Cancel)
        buttons.accepted.connect(self._save)
        buttons.rejected.connect(self.reject)
        layout.addWidget(buttons)

    def _test_connection(self):
        url = self.url_input.text().strip()
        token = self.token_input.text().strip()
        if not url or not token:
            self.status_label.setText("Fill in both fields first.")
            return

        self.status_label.setText("Testing...")
        client = ApiClient(url, token)
        if client.test_connection():
            self.status_label.setText("Connection OK!")
            self.status_label.setStyleSheet("color: green;")
        else:
            self.status_label.setText("Connection failed.")
            self.status_label.setStyleSheet("color: red;")

    def _save(self):
        url = self.url_input.text().strip()
        token = self.token_input.text().strip()
        if not url or not token:
            QMessageBox.warning(self, "Error", "Both fields are required.")
            return
        self.config.server_url = url
        self.config.admin_token = token
        self.config.save()
        self.accept()
