"""
    Baza stringów
"""

from pref import colors
from colorama import Fore, Style

# TODO - uzupelnienie stringow
# TODO - moze tlumaczenie


def strings_list():
    """

    :return:
    """
    # language = locale.getdefaultlocale() na mac os jest błąd
    language = "pl_PL"
    # print (locale.getdefaultlocale())
    language = language[0]
    if language == "pl_PL":
        print("POLSKI")
        strings = strings_pl()

    else:
        strings = strings_pl()  # domyślny zestaw stringów

    return strings


def strings_pl():
    """

    :return:
    """
    color = colors()
    strings = [
        Fore.BLUE + "...Uruchamiam CONCEPTFAB PM NX 0.8 DEV",  # 0
        Fore.BLUE + " Plik ustawień istnieje: ",  # 1
        Fore.RED + " Błąd: Plik z ustawieniami nie istnieje",  # 2
        Fore.BLUE + " Tworzę pusty plik z ustawieniami",  # 3
        Fore.RED + " Uzupełnij plik ustawień i uruchom program ponownie",  # 4
        Fore.BLUE + " Czytam plik: ",  # 5
        Fore.BLUE + " Błąd: Nie znaleziono folderu projektów ",  # 6
        Fore.BLUE + " Brakuje listy projektów.\nTworzę nową - pustą. ",  # 7
        Fore.BLUE + " \nKatalog projektów: ",  # 8
        Fore.BLUE + " Lista projektów: ",  # 9
        Fore.WHITE + " Czy chcesz dodać nowy projekt? ",  # 10
        Fore.BLUE + " ( T )",  # 11
        Fore.WHITE + " Aktualizować listę projektów? ",  # 12
        Fore.BLUE + " ( A )",  # 13
        Fore.RED + " Czy chcesz opuścić program? ",  # 14
        Fore.BLUE + " ( Q )",  # 15
        Fore.BLUE + " Jaki jest Twój wybór?  ",  # 16
        Fore.BLUE + " | Status projektu: ",  # 17
        Fore.BLUE + " Data utworzenia: ",  # 18
        Fore.BLUE + " Termin zakończenia ",  # 19
        Fore.BLUE + " Projekt po terminie",  # 20
        Fore.BLUE + " Aktywny ",  # 21
        Fore.BLUE + " Nieaktywny ",  # 22
        Fore.BLUE + " W archiuwm",  # 23
        Fore.BLUE + " Budżet",  # 24
        Fore.BLUE + " Rozmiar",  # 25
        Fore.BLUE + " Wyświetlić rozszerzoną listę projektów? ",  # 26
        Fore.BLUE + " ( W )",  # 27
        Fore.BLUE + " NULL ",  # 28
        Fore.BLUE + " NULL ",  # 29
        Fore.BLUE + " NULL ",  # 30
        Fore.BLUE + " Długa lista: ",  # 31
        Fore.BLUE + " Zamykam program",  # 32
        Fore.BLUE + " Dokonaj wyboru:",  # 33
        Fore.BLUE + " Tworzę nowy projekt:",  # 34
        Fore.BLUE + " Numer projektu: ",  # 35
        Fore.BLUE + " Rok: ",  # 36
        Fore.BLUE + " Podaj nazwę klienta: ",  # 36
        Fore.BLUE + " Wprowadzono: ",  # 37
        Fore.BLUE + " Podaj nazwę projektu: ",  # 38
        Fore.BLUE + " Podaj termin realizacji: ",  # 39
        Fore.BLUE + " Podaj budzet realizacji: ",  # 40
        Fore.BLUE + " Info: ",  # 41
        Fore.BLUE + " NULL ",  # 42
        Fore.BLUE + " NULL ",  # 43
        Fore.BLUE + " NULL ",  # 44
        Fore.BLUE + " Folder projektu został utworzony",  # 45
        Fore.BLUE
        + " ERROR: Nie utworzono folderu. Folder o takiej nazwie już istnieje",  # 46
        Fore.BLUE + " Folder projektów istnieje",  # 47
        Fore.BLUE + " ...Folder projektów istnieje...",  # 48
        Fore.BLUE + " ...Plik listy projektów istnieje...",  # 49
        Fore.BLUE + " BŁĄD: plik nie został znaleziony: ",  # 50
        Fore.BLUE + " Dodano projekt do Todoist: ",  # 51
        Fore.BLUE + " BŁĄD: Zawartość pliku jest nieprawidłowa ",  # 52
        Fore.BLUE + " BŁĄD: JSON FileNotFoundError",  # 53
        Fore.BLUE + " BŁĄD: JSON TypeError",  # 54
        Fore.BLUE + " Lista projektów została zaaktualizowana",  # 55
        Fore.BLUE + " Dodano projekt do Todoist: ",  # 56
    ]
    return strings
