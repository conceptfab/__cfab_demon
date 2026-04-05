"""
Główne funkcje
"""
import os


def create_dirs_tree(project_dict):
    """
    Funkcja tworzy folder projektu oraz drzewo katalogów
    :param project_dict: słownik projektu
    :return:
    """
    project_folder = (
        project_dict["prj_folder"]
        + "/"
        + project_dict["prj_number"]
        + "_"
        + project_dict["prj_year"]
        + "_"
        + project_dict["prj_client"]
        + "_"
        + project_dict["prj_name"]
    )
    try:
        # Tworzę folder projektu
        os.mkdir(project_folder)
    except FileExistsError:
        print("Nie można utworzyć folderu")  # TODO - do stringów dodać
        print(
            "Folder projektu " + project_folder + " juz istnieje"
        )  # TODO - do stringów dodać

    # Tworzę drzewo folderów projektu
    prj_tree = project_dict["prj_tree"]

    for dir in prj_tree:
        if prj_tree.index(dir) >= 10:
            # tworze sciezke do projektu dla folderów poniżej 10
            folder = str(prj_tree.index(dir)) + "_" + project_dict["prj_code"] + dir
            try:
                os.mkdir(project_folder + "/" + folder)
            except FileExistsError:
                print("Nie można utworzyć folderu")  # TODO - do stringów dodać
                print("Folder " + folder + " juz istnieje")  # TODO - do stringów dodać
        elif prj_tree.index(dir) <= 10:
            # tworze sciezke do projektu dla folderów powyżej 10
            folder = (
                "0" + str(prj_tree.index(dir)) + "_" + project_dict["prj_code"] + dir
            )
            try:
                os.mkdir(project_folder + "/" + folder)
            except FileExistsError:
                print("Nie można utworzyć folderu")  # TODO - do stringów dodać
                print("Folder " + folder + " juz istnieje")  # TODO - do stringów dodać
    # usuwam drzewo katalogów # TODO od sprawdzenia
    project_dict.pop("prj_tree", None)
    # my_dict.pop('key', None)
    return project_dict


def create_project_dict(prj_list):
    """Funkcja tworzy słownik z danymi projektu na bazie dostarczonej listy
    0=sciezka, 1=numer, 2=klient, 3=nazwa projektu
    """
    # usuwa znak _ tworzy kod projektu

    # Tworzę drzewo katalogów w oparciu o nazwę
    dirs_tree = folders_def(prj_list[5])

    prj_dict = {
        "prj_folder": prj_list[0],
        "prj_number": prj_list[1],
        "prj_year": prj_list[2],
        "prj_code": prj_list[3],
        "prj_client": prj_list[4],
        "prj_name": prj_list[5],
        "prj_desc": prj_list[7],
        "prj_full_name": prj_list[6],
        "prj_budget": prj_list[8],
        "prj_term": prj_list[9],
        "prj_status": "Aktywny",
        "prj_tree": dirs_tree,
    }
    return prj_dict


def folders_def(project_name):  # TODO zmienić na czystą listę
    """Definicja struktury drzewa folderów projektu"""
    list = [
        "_Sent_files_",
        "__Final_files__",
        "_CAD_files",
        "_Vector_files",
        "_2D_files",
        "_3D_scenes",
        "_3D_models",
        "_3D_sculpt",
        "_Materials",
        "_Textures",
        "_HDR_map",
        "_VR_online",
        "_" + project_name + "_IMG",
        "_RenderFarm_files",
        "_External_models",
        "_External_files",
        "___REF___",
    ]
    return list
