# Scholar Hover · Datenschutzhinweise

Version 0.3.1 · 2026-09-16

[简体中文](privacy.md) · [English](privacy.en.md) · [Français](privacy.fr.md)

Diese Erweiterung ergänzt ausschließlich Suchergebnisseiten, die Nutzer unter https://scholar.google.com/scholar öffnen. Sie liest Titel, Autoren, Jahr, Publikationsort und Links des ausgelösten Suchergebnisses, um die Publikation zu identifizieren. Sie automatisiert weder Suchanfragen noch das Blättern; Volltextdownloads werden vom Nutzer ausdrücklich in der Sammlungsverwaltung gestartet. Es gibt kein Produktkonto und keinen vom Projekt betriebenen Server.

## Empfänger der Daten

- OpenAlex erhält die DOI oder den Titel der ausgelösten Publikation, um Metadaten und Originalabstracts abzurufen. Ein angegebener OpenAlex-Schlüssel wird ausschließlich an api.openalex.org gesendet.
- Crossref erhält bei Bedarf die DOI, um fehlende Metadaten derselben Publikation zu ergänzen.
- Der vom Nutzer konfigurierte Modelldienst erhält den Titel der aktuellen Publikation, das abgerufene Originalabstract und Übersetzungsanweisungen für die gewählte Ausgabesprache erst nach der Einrichtung und der Zustimmung zur externen Übermittlung. Ohne Originalabstract werden nur der Titel und die Übersetzungsanweisungen übermittelt; es werden weder ein übersetztes Abstract noch eine Zusammenfassung erzeugt. Der API-Schlüssel des Modells wird ausschließlich an die konfigurierte HTTPS-Dienstadresse gesendet. Der Anbieter legt seine eigenen Regeln zur Datenspeicherung fest.
- Im automatischen Modus kann das Verweilen über einem Suchergebnis einen Modellaufruf auslösen und Kosten verursachen. Die Generierung kann stattdessen einen Klick erfordern. Das Schließen der Oberfläche garantiert nicht, dass bereits beim Anbieter entstandene Kosten storniert werden.

Oberflächen- und Ausgabesprache können unabhängig voneinander auf vereinfachtes Chinesisch, Englisch, Französisch oder Deutsch eingestellt werden. Für beide Einstellungen ist vereinfachtes Chinesisch der Standard. Die Spracheinstellungen werden lokal gespeichert. Wird nur die Oberflächensprache geändert, bleibt der Cache generierter Ergebnisse nutzbar; unterschiedliche Ausgabesprachen verwenden getrennte Einträge. Übersetzungen überschreiben die ursprünglichen Angaben zur Publikation nicht.

## Lokale Speicherung

Schlüssel werden standardmäßig im Sitzungsspeicher der Erweiterung abgelegt und beim Neustart des Browsers gelöscht. Wenn die lokale Aufbewahrung aktiviert wird, speichert die Erweiterung die Schlüssel in ihrem lokalen Speicher. Dies ist kein Passworttresor des Betriebssystems und keine Zusage einer verschlüsselten Aufbewahrung. Schlüssel werden weder in Webseiten noch in den synchronisierten Speicher, Analysedaten oder Protokolle geschrieben. Inhaltsskripte der Webseiten können den Schlüsselspeicher nicht lesen. Die Schlüssel können jederzeit gelöscht werden.

Publikationsdaten und generierte Ergebnisse werden ausschließlich lokal zwischengespeichert. Der Cache für generierte Ergebnisse ist auf 200 Einträge, sieben Tage und 4 MiB begrenzt. Ergebnisse verschiedener Modelle oder Ausgabesprachen belegen jeweils eigene Einträge, auch bei derselben Publikation. Das Leeren des Caches, das Löschen der Schlüssel und die Deinstallation haben ihre jeweiligen lokalen Löschwirkungen. Daten, die ein Anbieter bereits erhalten hat, können dadurch nicht gelöscht werden.

## Berechtigungen und Kontrolle

Die Erweiterung läuft ausschließlich auf Scholar-Suchseiten für Publikationen. Die Berechtigungen für OpenAlex und Crossref dienen dem Metadatenzugriff. Der Zugriff auf eine benutzerdefinierte Modelldomain wird beim Speichern der Konfiguration gesondert angefordert. Der optionale HTTPS-Domainbereich im Manifest ermöglicht benutzerdefinierte Adressen; bei der Installation wird kein Zugriff auf sämtliche Websites gewährt. Die Berechtigung `offscreen` ermöglicht einer ausgeblendeten, erweiterungseigenen Seite und einem dedizierten Worker, auf langsamere Modellantworten zu warten. Diese Seite liest keine Website-Inhalte; der Modellschlüssel wird weiterhin ausschließlich an den konfigurierten Modelldienst gesendet.

Diese Version enthält keine Werbung, keine automatische Telemetrie und keine Hintergrundübertragung von Nutzungsaufzeichnungen. Testdiagnosen werden lokal gespeichert; prüfen Sie deren Inhalt vor einer Weitergabe. Modellausgaben können fehlerhaft sein. Abstractübersetzungen und Zusammenfassungen kennzeichnen ihre Quellengrundlage und ersetzen weder Schlussfolgerungen aus dem vollständigen Text noch eine Qualitätsbewertung der Publikation. Tests auf echten Seiten und menschliche Prüfungen, einschließlich der Prüfung durch Muttersprachler aller vier Sprachen, sind noch nicht abgeschlossen.

Dieses Testpaket wurde noch nicht öffentlich veröffentlicht. Die Veröffentlichung in einem öffentlichen GitHub-Repository wartet auf die ausdrückliche Bestätigung des Nutzers nach seinem Test. Vor einer offiziellen Veröffentlichung im Store muss der Herausgeber dort einen erreichbaren Kontaktkanal und eine öffentliche Adresse dieser Datenschutzhinweise angeben.

## Bewusstes Speichern und Exportieren (0.3.0)

Artikel speichern legt Metadaten, Quellenlinks und vorhandene Übersetzungen in einer separaten lokalen Sammlung ab: höchstens 200 Artikel und 4 MiB, ohne automatischen Ablauf. Die Einträge bleiben bis zum Löschen, Leeren der Sammlung oder Deinstallieren der Erweiterung erhalten. Die siebentägige Frist und das Leeren des Generierungscaches betreffen diese Sammlung nicht. Spätere erfolgreiche Generierungen aktualisieren gespeicherte Artikel nur bei weiterhin übereinstimmendem Quellinhalt.

Der Export von Markdown und Originalen verwendet die Berechtigung downloads, um eine Markdown-Datei zu erstellen und bekannte Volltext-PDFs herunterzuladen. Die Anfragen gehen an den Volltextanbieter; Chrome sendet vorhandene Cookies dieser Website mit. Modell- und OpenAlex-Schlüssel werden nicht dorthin gesendet. Volltexte werden nicht an ein Modell übermittelt. Fehler werden angezeigt; die Originalseite des ersten Fehlers pro Export öffnet sich automatisch, weitere Seiten sind verlinkt. Anmeldung, institutionelle Authentifizierung und CAPTCHA erfolgen durch den Nutzer.

Dateinamen, Quellenlinks und Downloadstatus des letzten Exports werden zur Prüfung und Wiederholung lokal gespeichert. Antworten ohne PDF werden nicht als erfolgreich angezeigt; die Erweiterung versucht ausschließlich die dabei neu erzeugte ungültige Datei zu entfernen. Regulär exportierte Dateien bleiben im Downloadordner erhalten, auch wenn Sammlung, Cache oder Erweiterung entfernt werden. Es kommen keine Hintergrunduploads oder Telemetrie hinzu.
