def test_app_package_importable():
    import app.processing.loader  # noqa: F401
    assert True
