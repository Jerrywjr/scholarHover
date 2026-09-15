# Scholar Hover · Datenschutzhinweise

Version 0.2.0 · 2026-09-15

[简体中文](privacy.md) · [English](privacy.en.md) · [Français](privacy.fr.md)

Diese Erweiterung ergänzt ausschließlich Suchergebnisseiten, die Nutzer unter https://scholar.google.com/scholar öffnen. Sie liest Titel, Autoren, Jahr, Publikationsort und Links des ausgelösten Suchergebnisses, um die Publikation zu identifizieren. Sie automatisiert weder Suchanfragen noch das Blättern oder den Abruf von Volltexten. Es gibt kein Produktkonto und keinen vom Projekt betriebenen Server.

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

Die Erweiterung läuft ausschließlich auf Scholar-Suchseiten für Publikationen. Die Berechtigungen für OpenAlex und Crossref dienen dem Metadatenzugriff. Der Zugriff auf eine benutzerdefinierte Modelldomain wird beim Speichern der Konfiguration gesondert angefordert. Der optionale HTTPS-Domainbereich im Manifest ermöglicht benutzerdefinierte Adressen; bei der Installation wird kein Zugriff auf sämtliche Websites gewährt.

Diese Version enthält keine Werbung, keine automatische Telemetrie und keine Hintergrundübertragung von Nutzungsaufzeichnungen. Testdiagnosen werden lokal gespeichert; prüfen Sie deren Inhalt vor einer Weitergabe. Modellausgaben können fehlerhaft sein. Abstractübersetzungen und Zusammenfassungen kennzeichnen ihre Quellengrundlage und ersetzen weder Schlussfolgerungen aus dem vollständigen Text noch eine Qualitätsbewertung der Publikation. Tests auf echten Seiten und menschliche Prüfungen, einschließlich der Prüfung durch Muttersprachler aller vier Sprachen, sind noch nicht abgeschlossen.

Dieses Testpaket wurde noch nicht öffentlich veröffentlicht. Die Veröffentlichung in einem öffentlichen GitHub-Repository wartet auf die ausdrückliche Bestätigung des Nutzers nach seinem Test. Vor einer offiziellen Veröffentlichung im Store muss der Herausgeber dort einen erreichbaren Kontaktkanal und eine öffentliche Adresse dieser Datenschutzhinweise angeben.
