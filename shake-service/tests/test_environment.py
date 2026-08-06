"""Import/pin sanity — the environment is usable and matches the recorded pin."""

from shake_service import config


def test_openquake_pin_matches_config():
    import openquake.baselib

    assert config.OPENQUAKE_PIN == f"openquake.engine=={openquake.baselib.__version__}"


def test_all_four_d20_gsim_classes_import():
    from openquake.hazardlib.gsim.akkar_2014 import AkkarEtAlRjb2014
    from openquake.hazardlib.gsim.boore_2014 import BooreEtAl2014
    from openquake.hazardlib.gsim.chiou_youngs_2014 import ChiouYoungs2014
    from openquake.hazardlib.gsim.kale_2015 import KaleEtAl2015Iran

    for branch, cls in zip(
        config.GSIM_BRANCHES,
        (ChiouYoungs2014, AkkarEtAlRjb2014, BooreEtAl2014, KaleEtAl2015Iran),
    ):
        assert branch.class_name == cls.__name__


def test_context_maker_importable():
    from openquake.hazardlib.contexts import ContextMaker

    assert ContextMaker is not None


def test_ps2ff_importable():
    import ps2ff

    assert ps2ff is not None
