# TIMEFLOW - Project Rules

- **KAŻDA NOWA FUNKCJA** musi zostać dopisana do panelu pomocy (`Help.tsx`).
- Zapis **TIMEFLOW** musi być zawsze wielkimi literami.

Aplikacja działa poprawnie, ale przeanalizuj dokładnie kod dashboard i demona pod katem poprawności logiki, wydajności, możliwych optymalizacji, nadmiarowego kodu i sugerowanych rozwiązań oraz brakujących tłumaczeń oraz funkcjonalności nie opisanej w zakładkach help/pomoc. Swoje uwagi i propozycje zapisz w szczegółowym raport.md

---




Aplikacja działa poprawnie, ale przeanalizuj kod projektu pod katem:
- identyfikacji wszystkich procesów, porawności ich logiki, identyfikacji dublujących się funkcji lub  błedów logicznych
- wydajności i możliwych optymalizacji, poprawy wielowątkowości
- nadmiarowego kodu, refaktoryzacji, przygotowania do dynamicznego rozwoju - podziału na moduły
- braków i błędów w tłumaczeniu, braków w w zakładce help/pomoc
- sugestii dotyczących poprawy funkcjonalności
Priorytetem jest zachowanie dotychczasowych danych. Swoje uwagi zapisz w dokumencie refactor.md Rozpisz plan prac sugerując zmiany w kodzie. Szczegółowe poprawki mają powstać w kolejnym kroku i przeprowadzi je inny model, zostaw mu wskazówki by mógł sporządzić szczegółowy plan_implementacji.md

---

Aplikacja działa poprawnie, ale przeanalizuj kod projektu pod katem poprawności logiki, wydajności, możliwych optymalizacji, nadmiarowego kodu i sugerowanych rozwiązań oraz brakujących tłumaczeń (cały UI ma być po angielsku (pomoc i quick start są wyjątkiem). Przeanalizuj kod i logikę odpowiedzialną za AI, bo mam wątpliwości co do jej poprawności. Wszystkie zachowania AI muszą być precyzyjnie komunikowane by zachowaniu uzytkownika było elementem treningu. Sprawdz czygoś nie warto poprawic w jej rdzeniu i założeniach. Przygotuj aplikacje do dynamicznego rozwoju - podziel ją na moduły umożliwiające łatwe aktualizacje. Swoje uwagi i propozycje zapisz w szczegółowym raport.md

TODO ??

- detailed nie dziala

<!-- - czy refresh w Dashbordzie jest potrzebny?
- podział sesji
- refactor duży plików
- znaczek na NEW -->

<!-- - czy faktycznie dziala dzielenie sesji - do sprawdzenia -->
- licznik plików edytowanych w sesji/projekcie nie działa prawidłowo - zweryfikuj czy jest szansa na wiarygodny wynik, czy warto usunąć ten licznik
<!-- - poprawa modułów sesji w raporcie z boostami, z komentarzami, z manualnymi -->
<!-- - fonty systemowe do wyboru -->
<!-- - uporządkowanie settings -> Session Split wyzej logicznie poukładane! -->
<!-- - skalowanie fontów w raporcie nie działa -->
<!-- - przycisk zapisz do pdf jest chujowym miejscu! -->
<!-- - lista fontów jest zle wyswietlana -->
- poprawic header raportu
- Activity Over Time w raporcie
