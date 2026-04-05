from colorama import Fore


def colors():
    """
    definicje kolorów
    """
    color = [
        Fore.WHITE,  # color_0 WHITE
        Fore.YELLOW,  # color_1GREY
        Fore.BLUE,  # color_2 BLUE
        Fore.CYAN,  # color_3 CYAN
        Fore.RED,  # color_5 RED
        Fore.MAGENTA,  # color_2 VIOLET
        Fore.GREEN,
    ]
    return color


# colors.append('\033[1;32;48m') # color_4 YELLOW
# colors.append('\033[1;30;48m') # color_6 WHITE
# colors.append('\033[1;33;48m') # color_7 YELLOW
# colors.append('\033[1;30;48m') # color_8 GREY


def paleta():
    print("\033[1;34;48m Normal text\n")
    print("\033[2;37;40m Underlined text\033[0;37;40m \n")
    print("\033[1;37;40m Bright Colour\033[0;37;40m \n")
    print("\033[3;37;40m Negative Colour\033[0;37;40m \n")
    print("\033[5;37;40m Negative Colour\033[0;37;40m\n")

    print(
        "\033[1;37;40m \033[2;37:40m TextColour BlackBackground          TextColour GreyBackground                WhiteText ColouredBackground\033[0;37;40m\n"
    )
    print(
        "\033[1;30;40m Dark Gray      \033[0m 1;30;40m     \033[0;30;47m Black      \033[0m 0;30;47m      \033[0;37;41m Black      \033[0m 0;37;41m"
    )
    print(
        "\033[1;31;40m Bright Red     \033[0m 1;31;40m     \033[0;31;47m Red        \033[0m 0;31;47m      \033[0;37;42m Black      \033[0m 0;37;42m"
    )
    print(
        "\033[1;32;40m Bright Green   \033[0m 1;32;40m     \033[0;32;47m Green      \033[0m 0;32;47m      \033[0;37;43m Black      \033[0m 0;37;43m"
    )
    print(
        "\033[1;33;40m Yellow         \033[0m 1;33;40m     \033[0;33;47m Brown      \033[0m 0;33;47m      \033[0;37;44m Black      \033[0m 0;37;44m"
    )
    print(
        "\033[1;34;40m Bright Blue    \033[0m 1;34;40m     \033[0;34;47m Blue       \033[0m 0;34;47m      \033[0;37;45m Black      \033[0m 0;37;45m"
    )
    print(
        "\033[1;35;40m Bright Magenta \033[0m 1;35;40m     \033[0;35;47m Magenta    \033[0m 0;35;47m      \033[0;37;46m Black      \033[0m 0;37;46m"
    )
    print(
        "\033[1;36;40m Bright Cyan    \033[0m 1;36;40m     \033[0;36;47m Cyan       \033[0m 0;36;47m      \033[0;37;47m Black      \033[0m 0;37;47m"
    )
    print(
        "\033[1;37;40m White          \033[0m 1;37;40m     \033[0;37;40m Light Grey \033[0m 0;37;40m      \033[0;37;48m Black      \033[0m 0;37;48m"
    )
    print("\n")
