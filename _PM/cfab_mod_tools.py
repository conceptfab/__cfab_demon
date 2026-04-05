"""
    Podstawowe funkcje
"""
import json
import logging
import os
import platform
import shutil
from datetime import datetime as dt

from cfab_mod_strings import strings_list
from cfab_mod_view import view_projects_list

# TODO czysta lista projektow + dodawanie istniejacych projektow

logging.basicConfig(
    level=logging.DEBUG, format=" %(asctime)s -  %(levelname)s -  %(message)s"
)
# logging.disable(logging.CRITICAL)

# stringi
STRING = strings_list()

OS_SELECTOR = platform.system()
while OS_SELECTOR == "Darwin":
    OS_SELECTOR = "macOS"


def set_settings_file(file):  # TODO DO NAPRAWY
    """
    Funkcja ustala sciezke do pliku ustawien
    """
    logging.debug("cfab_mod_file: set_settings_file")
    print(os.path.dirname(os.path.abspath(__file__)))
    real_path = os.path.dirname(os.path.abspath(__file__))
    # real_path = (os.path.realpath(__file__))
    if OS_SELECTOR == "Windows":
        real_path = real_path + "\\" + file
    elif OS_SELECTOR == "macOS":
        real_path = real_path + "/" + file
    real_path = real_path.replace(__file__, "")
    print(real_path)

    return real_path


def convert_path(real_path):
    """
        XXX
    :param real_path:
    :return:
    """
    if OS_SELECTOR == "Windows":
        logging.debug("cfab_mod_file: convert_path: windows")
        convert_path = real_path.replace("\\", "/")
        print(convert_path)
        # print(logstr() + STRINGS[5] + convert_path) #TODO sprawdzic

    elif OS_SELECTOR == "macOS":
        logging.debug("cfab_mod_file: convert_path: macOS")
        convert_path = real_path
        # print(logstr() + STRINGS[5] + convert_path) #TODO sprawdzic

    return convert_path


def check_settings_file(real_path):
    """spradzam czy plik ustawien istnieje"""
    logging.debug("cfab_mod_tools: check_settings_file")
    convert_path(real_path)
    """ sprawdzam czy plik ustawien istnieje"""
    if os.path.isfile(real_path) is True:
        # TODO jesli istnieje sprawdzic czy jest pusty
        # print(logstr() + STRINGS[1] + real_path)  # plik ustawien istnieje
        file_exists = True

    if os.path.isfile(real_path) is False:
        file_exists = False

    return file_exists


def read_settings(file):
    """odczytuje plik ustawien,
    przesyłam do czyszczenia -> def clear_settings i
    wysłam do domu
    """
    if OS_SELECTOR == "Windows":
        file = open(file, "r", encoding="utf -8")
        load_settings = file.readlines()
        clear_data = clear_settings(load_settings)

    elif OS_SELECTOR == "macOS":
        file = open(file, "r", encoding="utf -8")
        load_settings = file.readlines()
        clear_data = clear_settings(load_settings)

    return clear_data


def clear_settings(dirt_settings):
    # TODO do sprawdzenia ustawienia
    # TODO uprosic listę - dopasować do systemu
    # TODO dopisac folder ustawien???
    """
    czyszcze preferencje
    """

    clear_settings_0 = dirt_settings[0]
    clear_settings_0 = clear_settings_0.replace("windows_work_folder = ", "")
    clear_settings_0 = clear_settings_0.strip(" \t\n\r")

    clear_settings_1 = dirt_settings[1]
    clear_settings_1 = clear_settings_1.replace("macos_work_folder = ", "")
    clear_settings_1 = clear_settings_1.strip(" \t\n\r")

    clear_settings_2 = dirt_settings[2]
    clear_settings_2 = clear_settings_2.replace("projects_list = ", "")
    clear_settings_2 = clear_settings_2.strip(" \t\n\r")
    clear_settings_2 = "00_PM_NX/" + clear_settings_2

    clear_settings_3 = dirt_settings[3]
    clear_settings_3 = clear_settings_3.replace("todoist_token = ", "")
    clear_settings_3 = clear_settings_3.strip(" \t\n\r")

    clear_settings_4 = dirt_settings[4]
    clear_settings_4 = clear_settings_4.replace("settings_folder = ", "")
    clear_settings_4 = clear_settings_4.strip(" \t\n\r")

    clear_settings_5 = dirt_settings[5]
    clear_settings_5 = clear_settings_5.replace("language = ", "")
    clear_settings_5 = clear_settings_5.strip(" \t\n\r")

    clear_settings_6 = dirt_settings[6]
    clear_settings_6 = clear_settings_6.replace("login = ", "")
    clear_settings_6 = clear_settings_6.strip(" \t\n\r")

    clear_settings_7 = dirt_settings[7]
    clear_settings_7 = clear_settings_7.replace("password = ", "")
    clear_settings_7 = clear_settings_7.strip(" \t\n\r")

    clear_settings_8 = dirt_settings[8]
    clear_settings_8 = clear_settings_8.replace("gmail = ", "")
    clear_settings_8 = clear_settings_8.strip(" \t\n\r")

    clear_settings_9 = dirt_settings[9]
    clear_settings_9 = clear_settings_9.replace("gpassword = ", "")
    clear_settings_9 = clear_settings_9.strip(" \t\n\r")

    clear_settings_10 = dirt_settings[10]
    clear_settings_10 = clear_settings_10.replace("tomail = ", "")
    clear_settings_10 = clear_settings_10.strip(" \t\n\r")

    if OS_SELECTOR == "Windows":
        clear_settings_2 = clear_settings_0 + "\\" + clear_settings_2
        clear_data_list = (
            clear_settings_0,
            clear_settings_2,
            clear_settings_3,
            clear_settings_4,
            clear_settings_5,
            clear_settings_6,
            clear_settings_7,
            clear_settings_8,
            clear_settings_9,
            clear_settings_10,
        )

    elif OS_SELECTOR == "macOS":
        clear_settings_2 = clear_settings_1 + "/" + clear_settings_2
        clear_data_list = (
            clear_settings_1,
            clear_settings_2,
            clear_settings_3,
            clear_settings_4,
            clear_settings_5,
            clear_settings_6,
            clear_settings_7,
            clear_settings_8,
            clear_settings_9,
            clear_settings_10,
        )

    return clear_data_list


def check_work_folder(work_folder):
    # TODO do przerobienia
    """
    Funkcja sprawdza czy work folder (folder projektów) istnieje
    :param work_folder:
    :return:
    """

    if os.path.exists(work_folder) is True:
        status = True

    elif os.path.exists(work_folder) is False:
        status = False

    return status


def check_settings_folder(settings_folder_path):
    """
    Sprawdzam czy folder 00_PM_NX istnieje
    :param settings_folder_path: sciezka folderu
    :return: false or true
    """

    folder = os.path.exists(settings_folder_path)
    if folder is False:
        create_settings_folder(settings_folder_path)
    elif folder is True:
        print("Folder preferencji istnieje")  # TODO dodać do stringów


def create_settings_folder(settings_folder_path):
    """
    Tworzę domyślny folder z ustawienia/listą projektów,
    defaultowym plikiem ac i folderem backup
    :param settings_folder_path: sciezka folderu
    :return:
    """
    try:
        os.mkdir(settings_folder_path)
    except FileExistsError:
        print("Folder istnieje: 00_PM_NX")  # TODO dodać do stringów
    try:
        os.mkdir(settings_folder_path + "/backup")
    except FileExistsError:
        print("Folder istnieje: backup")  # TODO dodać do stringów
    try:
        os.mkdir(settings_folder_path + "/default_files")
    except FileExistsError:
        print("Folder istnieje: default_files")  # TODO dodać do stringów


def projects_list(settings_list):
    """
    Funkcja wysyła do sprawdzenia czy lista projektow istnieje ->
    check_projects_list(settings_list)
    czyta -> projects_dict = project_json_read(settings_list[1])
    i wysyła -> view_projects_list(projects_dict)
    :param settings_list:
    :return:
    """
    status = check_projects_list(settings_list)
    if status is False:
        print("Fuck!!! - tworzę pusty listę projektów")
        create_clear_file(settings_list[1])
    elif status is True:
        # TODO poprawić wyświetlanie

        list_size = os.path.getsize(settings_list[1])
        # print('size ' + str(a)) #TODO do sprawdzenia

        if list_size != 0:
            projects_dict = project_json_read(settings_list[1])
            view_projects_list(projects_dict, settings_list[0])

        elif list_size == 0:
            # TODO dodac komunikaty
            create_clear_file(settings_list[1])

        return


def check_projects_list(settings_list):
    """
    Funkcja sprawdza czy plik listy projektow istnieje
    :param settings_list:
    :return:
    """
    if os.path.isfile(settings_list[1]) is False:
        status = False

    elif os.path.isfile(settings_list[1]) is True:
        status = True

    return status


def project_json_read(filename):
    """
        Czytam listę projektów
    :param filename:
    :return:
    """
    try:
        with open(filename, "r") as file:
            projects_dict = json.load(file)
        return projects_dict
    except:
        create_clear_file(filename)


def project_json_write(filename, new_project_dict):
    """
    Dodaje nowy projekt do pliku project_list.json [ lista ]
    :param filename:
    :param new_project_dict:
    :return:
    """
    backup_project_list(filename)
    try:
        with open(filename, "r") as file:
            projects_dict = json.load(file)

    except ValueError:
        projects_dict = []

    status = "w"

    projects_dict.append(new_project_dict)

    with open(filename, status) as file:
        print(" - - - write")  # TODO dodac do stringow
        json.dump(projects_dict, file)


def backup_project_list(filename):
    """
    # TODO dodać numer pliku backapu - lista plików + ostatni numer
    :param filename:
    :return:
    """
    time_stamp = str(dt.now().strftime("_%H%M%S_%d%m%Y"))
    new_name = (
        "/backup/backup_projects_list" + time_stamp + ".json"
    )  # [INFO} sciezka do backupu
    backup_name = filename.replace("projects_list.json", new_name)
    shutil.copyfile(filename, backup_name)


# TODO poprawić brak listy
def create_clear_file(filename):
    """

    :param filename:
    :return:
    """
    null_list = []
    if os.path.isfile(filename) is True:
        os.remove(filename)

        with open(filename, "w") as outfile:
            json.dump(null_list, outfile)

    if os.path.isfile(filename) is False:
        with open(filename, "w") as outfile:
            json.dump(null_list, outfile)
