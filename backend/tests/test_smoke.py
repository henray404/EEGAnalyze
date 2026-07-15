def test_app_package_importable():
    import app.processing.io.loader  # noqa: F401
    assert True
