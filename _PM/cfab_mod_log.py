"""
Funkcje obsługi logów
"""
import datetime

from pref import colors


def logstr():
    """
            Domyślny log
    :return: zwraca date loga
    """
    color = colors()
    now = datetime.datetime.now()
    now = now.strftime("%Y-%m-%d %H-%M:%S")
    log_string = color[3] + "[ " + str(now) + " ] "
    return log_string
