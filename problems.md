# Problemy do naprawienia

## 1. Dashboard nie pokazuje sesji Unassigned
**Opis:**
Dashboard nie pokazuje żadnej sesji Unassigned, a demon pokazuje np. 2.

**Kroki do reprodukcji:**
1. Zamykam oba programy (Dashboard i Demon).
2. Usuwam plik `assignment_attention.txt`.
3. Uruchamiam Dashboard -> tworzony jest plik `assignment_attention.txt` z zawartością `0`.
4. Uruchamiam demona -> automatycznie w pliku `assignment_attention.txt` zostaje zapisana wartość `2`.
5. Dashboard nadal nie pokazuje sesji Unassigned!
