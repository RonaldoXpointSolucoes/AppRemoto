package setup

// Detection and installation are separated so an existing service never invokes the bundled installer.
func reuseOrInstallRustDesk(find func() (string, error), serviceExists func() (bool, error), bundled bool, install func() (string, error)) (string, bool, error) {
	if path, err := find(); err == nil {
		return path, true, nil
	}
	exists, err := serviceExists()
	if err != nil {
		return "", false, err
	}
	if exists {
		return "", false, &preparationError{"RUSTDESK_CONFLICT"}
	}
	if !bundled {
		return "", false, &preparationError{"RUSTDESK_MISSING"}
	}
	path, err := install()
	return path, false, err
}
