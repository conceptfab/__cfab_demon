"""
    Funkcje tworzące nowy projekt
"""
import datetime
import json
import logging
import shutil

from colorama import Fore

# from cfab_mod_adds import addtodoist, send_email
from cfab_mod_dirs import create_project_dict, create_dirs_tree
from cfab_mod_tools import project_json_write

# logging.basicConfig(level=logging.DEBUG, format=' %(asctime)s -  %(levelname)s -  %(message)s')
logging.disable(logging.CRITICAL)


def read_project_list(filename):
    """

    :param filename:
    :return:
    """
    with open(filename, "r", encoding="utf-8") as file:
        projects_dict = json.load(file)
    return projects_dict


def create_new_project(settings_list):
    """
    Tworzę nowy projekt
    :param settings_list: lista ustwien
    :return:
    """

    separator = "                    "

    # prj_list_nr = input('Podaj nr projektu: ')

    projects_dict = read_project_list(settings_list[1])
    number_of_projects = search_number(projects_dict)

    prj_list_nr = new_number(number_of_projects)
    print("Numer projektu:         " + prj_list_nr)  # TODO dodać do stringów

    prj_list_year = datetime.datetime.now().strftime("%y")
    prj_list_code = prj_list_nr + prj_list_year

    prj_list_client = input(
        Fore.RED + "Podaj nazwę klienta: "
    )  # TODO dodać do stringów
    print(separator + prj_list_client)

    prj_list_name = input("Podaj nazwę projektu: ")  # TODO dodać do stringów
    print(separator + prj_list_name)

    prj_list_desc = input("Podaj opis projektu: ")  # TODO dodać do stringów
    print(separator + prj_list_desc)

    # TODO dodać do stringów
    prj_list_budget = input("Podaj budzet projektu: ")
    print(separator + prj_list_budget)

    prj_list_term = input("Podaj termin projektu: ")  # TODO dodać do stringów
    print(separator + prj_list_term)  # TODO FORMAT DATY

    # Tworzę listę z danymi projektu
    prj_full_name = (
            prj_list_nr + "_" + prj_list_year + "_" + prj_list_client + "_" + prj_list_name
    )
    prj_list = (
        settings_list[0],
        prj_list_nr,
        prj_list_year,
        prj_list_code,
        prj_list_client,
        prj_list_name,
        prj_full_name,
        prj_list_desc,
        prj_list_budget,
        prj_list_term,
    )
    # Tworzę folder z projektu wraz z wewnętrznymi folderami i wysłam listę z danymi projektu
    project_dict = create_project_dict(prj_list)

    create_dirs_tree(project_dict)

    # TODO - zapisywanie listy do pliku json

    project_json_write(settings_list[1], project_dict)
    logging.debug("MENU - input choice - NOWY PROJEKT")
    # TODO usunąć '_'  z project dict

    # addtodoist(project_dict, settings_list[5], settings_list[6])
    # send_email(project_dict, settings_list[7], settings_list[8], settings_list[9])

    copy_default_files(settings_list, prj_list)


# def search_number(projects_dict):
#     '''
#     Liczę projekty
#     :param project_dict: lista projectów
#     :return: zwracam liczbę projektów
#     '''
#     # number_list = []
#     # sprawdzam czy projekty jest z tego roku
#     year = datetime.datetime.now().strftime("%y")
#     number_of_projects = len(projects_dict)
#     print(number_of_projects)
#
#
#     if number_of_projects > 0:
#         for project in projects_dict:
#
#             if project['prj_year'] != year:
#                 # nie ma projektów z bieżącego roku
#                 projects_this_year = 0
#
#                 return projects_this_year
#
#             elif project['prj_year'] == year:
#                 print('YES')
#
#             else:
#
#                 # number_list.append(project['prj_number'])
#                 # print(number_list)
#                 number_list = number_of_projects
#                 projects_this_year = number_list
#                 return projects_this_year
#     if number_of_projects == 0:
#         projects_this_year = 0
#         return projects_this_year


def search_number(projects_dict):
    """
    Liczę projekty
    :param project_dict: lista projectów
    :return: zwracam liczbę projektów
    """
    # number_list = []
    # sprawdzam czy projekty jest z tego roku
    year = datetime.datetime.now().strftime("%y")
    number_of_projects = len(projects_dict)

    if number_of_projects > 0:
        x = 0
        y = 0

        for project in projects_dict:
            if project["prj_year"] == year:
                x = x + 1

        print("Liczba wszystkich projektów: " + str(number_of_projects))
        print("Liczba projektów w tym roku: " + str(x))

    if number_of_projects == 0:
        x = y

    return x


def new_number(number_list):
    """
    Tworzę nowy numer projektu
    :param number_list: lista projektów
    :return: zwracam nowy numer
    """
    # TODO dodac zliczanie projektów z danego roku
    if number_list == 0:
        print("Tworzę pierwszy projekt w roku")

    if number_list < 9:
        number = number_list + 1
        number = "0" + str(number)

    # elif number_list >= 9:
    #     number = number_list + 1
    #     return str(number)
    else:
        number = number_list + 1

    return str(number)


def copy_default_files(settings_list, prj_list):
    """
    Kopiuje domyslny plik AC do folderu projektu
    :param settings_folder_path: ustawienia / sciezki
    :param prj_nr: project dict / numer projektu
    :return:
    """

    path = settings_list[0] + "/" + settings_list[3] + "/default_files/default.pln"
    prj_name = prj_list[6]
    new_path = (
            settings_list[0]
            + "/"
            + prj_name
            + "/02_"
            + prj_list[3]
            + "_CAD_files/"
            + prj_name
            + ".pln"
    )
    try:
        shutil.copy2(path, new_path)
    except FileNotFoundError:
        print("Plik nie istnieje")  # TODO dodać do stringów
