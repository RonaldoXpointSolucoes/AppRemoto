//go:build windows

package setup

import (
	_ "embed"
	"path/filepath"
)

//go:embed assets/rustdesk-LICENCE.txt
var rustDeskLicense []byte

const rustDeskNotice = "RustDesk 1.4.9 is distributed unchanged as a separate component.\r\nCopyright RustDesk contributors. Licensed under GNU AGPL version 3.\r\nLicense: rustdesk-LICENCE.txt\r\nSource and build instructions: https://github.com/rustdesk/rustdesk/tree/1.4.9\r\nRequired source submodule: https://github.com/rustdesk/hbb_common/tree/7e1c392c62d39c364127307cd408421dd5f8cfb0\r\nOfficial distribution: https://github.com/rustdesk/rustdesk/releases/tag/1.4.9\r\nXPoint configures this component; the RustDesk executable is not modified.\r\n"

func writeLegalNotices(directory string) error {
	if err := replacePrivate(filepath.Join(directory, "rustdesk-LICENCE.txt"), rustDeskLicense, true); err != nil {
		return err
	}
	return replacePrivate(filepath.Join(directory, "THIRD-PARTY-NOTICES.txt"), []byte(rustDeskNotice), true)
}
