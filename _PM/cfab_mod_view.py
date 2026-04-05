"""
Moduł zawierający widoki list
"""
import logging
import os

from colorama import Fore, Style

logging.basicConfig(
    level=logging.DEBUG, format=" %(asctime)s -  %(levelname)s -  %(message)s"
)


# logging.disable(logging.CRITICAL)


def add_zeros(string):
    length = len(string)
    if length == 1:
        return "00" + string
    elif length == 2:
        return "0" + string
    else:
        return string


def get_folder_size(folder_path):
    total = 0
    for path, dirs, files in os.walk(folder_path):
        for f in files:
            fp = os.path.join(path, f)
            total += os.path.getsize(fp)
    return round(total / (1024**3), 2)


def check_folder_status(folder_path, path):
    if os.path.isdir(path + "\\" + folder_path):
        size = get_folder_size(path + "\\" + folder_path)
        return str(Fore.GREEN + "Aktywny => " + str(size) + " GB")
    else:
        return str(Fore.BLUE + "Archiwalny")


def view_projects_list(projects_dict, path):
    """
    Krótka lista projektów
    :param projects_dict: słownik projektu
    :return:
    """
    logging.debug("cfab_mod_view: view_projects_list / short list")
    null_list = []
    # print("\n")
    print("Lista projektów: " + path + "\n")  # TODO dodać do stringów
    x = 0

    if projects_dict != null_list:
        # Wyswietlam prosta liste projektów
        for projects in projects_dict:
            x += 1
            print(
                Fore.BLUE
                + add_zeros(str(x))
                + Fore.CYAN
                + " | "
                + "20"
                + projects["prj_year"]
                + " | "
                + Fore.RED
                + projects["prj_number"]
                + Style.RESET_ALL
                + "  "
                + projects["prj_client"]
                + "  "
                + projects["prj_name"]
                + " | "
                + check_folder_status(projects["prj_full_name"], path)
            )

    elif projects_dict == null_list:
        # Nie wyświetlam listy
        print("NULL")  # TODO dopisac komentarz
        return
    print("\n")
