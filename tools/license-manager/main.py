import sys

from PyQt6.QtWidgets import QApplication

from config import AppConfig
from main_window import MainWindow


def main():
    app = QApplication(sys.argv)
    app.setApplicationName("TIMEFLOW License Manager")

    config = AppConfig.load()
    window = MainWindow(config)
    window.show()

    sys.exit(app.exec())


if __name__ == "__main__":
    main()
