"""
    Moduł główny
"""
import logging

from cfab_mod_log import logstr
from cfab_mod_new_prj import create_new_project
from cfab_mod_strings import strings_list
from cfab_mod_tools import (
    check_settings_file,
    check_settings_folder,
    check_work_folder,
    project_json_read,
    projects_list,
    read_settings,
    set_settings_file,
)


# logging.basicConfig(level=logging.DEBUG, format=' %(asctime)s -  %(levelname)/s -  %(message)s')
logging.disable(logging.CRITICAL)


# Wersja 0.4 SILVERP

# TODO - dodać selektor jezyków
# TODO - przerobienie stringów
# TODO - info startowe
# TODO - usunąć błędy PYLINT
# TODO aktualizacja statusu
# TODO dobrze opisać funckje + logowanie każdej funkcji
# TODO - optymalizacja, opisanie funkcji
# TODO - dodawanie projektu do listy, zarządzanie listą - czytanie, zapisywanie
# TODO - budzet projektów
# TODO - termin projektu - odliczanie
# TODO - usuwanie/kompresja projektów??


def input_choice(settings_list, strings):
    """
    Wyświetlam menu
    :param settings_list:
    :return:
    """

    print(
        strings[10]
        + strings[11]
        + "\n"  # Czy chcesz dodać nowy projekt?  ( T )
        + strings[14]
        + strings[15]
    )  # Czy opuścić program?  ( Q )

    choice = input(strings[16])
    #  opcje menu
    select_choice(choice, settings_list, strings)


def select_choice(choice, settings_list, strings):
    """

    :param choice:
    :param settings_list:
    :return:
    """
    if choice in ("T", "t"):
        # -> cfab_mod_new_prj.py
        create_new_project(settings_list)
        input_choice(settings_list, strings)

    elif choice in ("Q", "q"):
        logging.debug("MENU - input choice - KONIEC")
        print(strings[32])
        quit()

    else:
        logging.debug("MENU - input choice - ???")
        print(strings[33])
        input_choice(settings_list, strings)


def run_main():
    """

    :return:
    """
    strings = strings_list()
    print(strings[0])  # ...Uruchamiam...

    # sprawdzam czy plik settings.txt istnieje
    settings_file = set_settings_file("settings.txt")

    settings_file_status = check_settings_file(settings_file)
    print(settings_file_status)

    if settings_file_status is True:
        logging.debug("pm2_NEXT: settings_file_status == True")

        settings_list = read_settings(settings_file)
        print("Czytam ustawienia")


    elif settings_file_status is False:
        # TODO ogarnąć to
        logging.debug("pm2_NEXT: settings_file_status == False")

        # plik ustawien nie istnieje # TODO ogarnąć to
        print(logstr() + strings[2])
        # tworzę pusty plik ustawien # TODO ogarnąć to
        print(logstr() + strings[3])
        # TODO dodać tworzenie domyslnego pliku
        # uzupełnij plik ustawień i uruchom program ponownie
        print(logstr() + strings[4])
        print("FUCK")
    # exit()

    work_folder_status = check_work_folder(settings_list[0])  # TODO dodać wyjątki

    print("Work Folder: " + str(work_folder_status))  # TODO opisać status

    settings_folder_path = settings_list[0] + "/" + settings_list[3]
    check_settings_folder(settings_folder_path)

    # wyświetlam listę projektów
    projects_list(settings_list)

    # wyświetlam menu
    input_choice(settings_list, strings)


if __name__ == "__main__":
    run_main()
