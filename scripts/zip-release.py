import os
import stat
import sys
import zipfile
from pathlib import Path
source, destination, root = Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3]
with zipfile.ZipFile(destination, 'w', zipfile.ZIP_DEFLATED, compresslevel=6, allowZip64=False) as archive:
    def add(directory):
        for file in sorted(directory.iterdir()):
            name = root + '/' + file.relative_to(source).as_posix()
            if file.name in ('.DS_Store', 'credentials.json'):
                continue
            if file.is_symlink():
                info = zipfile.ZipInfo(name)
                info.create_system = 3
                info.external_attr = (stat.S_IFLNK | 0o777) << 16
                archive.writestr(info, os.readlink(file))
            elif file.is_dir():
                add(file)
            else:
                archive.write(file, name)
    add(source)
