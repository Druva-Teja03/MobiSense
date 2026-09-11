CREATE USER 'mobisense_app'@'localhost' IDENTIFIED BY 'MobiSense2026';
GRANT ALL PRIVILEGES ON mobisense_db.* TO 'mobisense_app'@'localhost';
FLUSH PRIVILEGES;