from __future__ import annotations

import ftplib
import sys
import re
from pathlib import Path

try:
    import ftp_config
except ImportError:
    print("BŁĄD: Brak pliku konfiguracyjnego ftp_config.py")
    sys.exit(1)

def get_highest_version_zip(dist_dir: str) -> Path | None:
    dist_path = Path(dist_dir)
    if not dist_path.exists() or not dist_path.is_dir():
        print(f"BŁĄD: Folder {dist_dir} nie istnieje.")
        return None

    zip_files = []
    # Szukamy plików typu TIMEFLOW_v0.1.49.zip
    pattern = re.compile(r"TIMEFLOW_v(\d+)\.(\d+)\.(\d+)\.zip$")
    
    for file_path in dist_path.glob("TIMEFLOW_v*.zip"):
        match = pattern.search(file_path.name)
        if match:
            version_tuple = (int(match.group(1)), int(match.group(2)), int(match.group(3)))
            zip_files.append((version_tuple, file_path))
            
    if not zip_files:
        print(f"BŁĄD: Nie znaleziono żadnych pasujących plików ZIP w {dist_dir}.")
        return None
        
    # Sortujemy malejąco po krotce z wersją (najwyższa wersja będzie pierwsza)
    zip_files.sort(key=lambda x: x[0], reverse=True)
    return zip_files[0][1]

def main() -> None:
    dist_dir = "dist"
    latest_zip = get_highest_version_zip(dist_dir)
    
    if not latest_zip:
        sys.exit(1)
        
    print(f"-> Wybrano plik do wysłania: {latest_zip.name}")
    
    print(f"Łączenie z serwerem FTP: {ftp_config.FTP_HOST}...")
    try:
        ftp = ftplib.FTP(ftp_config.FTP_HOST)
        ftp.login(ftp_config.FTP_USER, ftp_config.FTP_PASS)
        print("Połączono pomyślnie.")
        
        try:
            ftp.cwd(ftp_config.FTP_DIR)
            print(f"Zmieniono katalog docelowy na: {ftp_config.FTP_DIR}")
        except ftplib.error_perm:
            print(f"Katalog docelowy może nie istnieć. Próba utworzenia...")
            try:
                # Wymaga rekursywnego tworzenia w niektórych przypadkach, ale tu zakładamy prostą strukturę
                ftp.mkd(ftp_config.FTP_DIR)
                ftp.cwd(ftp_config.FTP_DIR)
            except Exception as e:
                print(f"Nie udało się przejść do/utworzyć docelowego katalogu: {e}")
                ftp.quit()
                sys.exit(1)
            
        print(f"-> Wgrywanie pliku: {latest_zip.name}...")
        with open(latest_zip, 'rb') as f:
            ftp.storbinary(f'STOR {latest_zip.name}', f)
            
        ftp.quit()
        print("-> Transfer zakończony sukcesem. Rozłączono.")
        
        # Generowanie linku do pobrania
        # Zakładamy, że ftp_config.FTP_HOST (np. host372606.hostido.net.pl) 
        # i FTP_DIR (np. /public_html/timeflow/download) 
        # można zmapować na docelowy URL (np. https://conceptfab.com/timeflow/download/)
        # Tutaj proste mapowanie bazujące na nazwie pliku:
        # User używa conceptfab.com wg configu: vscode@conceptfab.com.
        domain = ftp_config.FTP_USER.split('@')[-1] if '@' in ftp_config.FTP_USER else ftp_config.FTP_HOST
        
        # Czyszczenie ścieżki (usuwanie /public_html jeśli istnieje)
        web_path = ftp_config.FTP_DIR.replace('/public_html', '')
        if not web_path.startswith('/'):
            web_path = '/' + web_path
        if not web_path.endswith('/'):
            web_path += '/'
            
        download_link = f"https://{domain}{web_path}{latest_zip.name}"
        
        print("\n" + "="*60)
        print(f"LINK DO POBRANIA: {download_link}")
        print("="*60 + "\n")
        
    except Exception as e:
        print(f"Błąd transferu FTP: {e}")

if __name__ == "__main__":
    main()
