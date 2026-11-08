"""Capability-checked Home tile controls; only the configured entity is addressed."""
import math
from .home_theme import model
from .layout_cards import card_metadata


async def async_execute(hass, entity_id, action, value=None):
    state=hass.states.get(entity_id)
    if not state or state.state in ('unavailable','unknown'):
        raise ValueError('Home target unavailable')
    domain=state.domain;attrs=state.attributes;features=int(attrs.get('supported_features') or 0)
    data={'entity_id':entity_id}
    if action=='home_primary':
        if value is not None:raise ValueError('Unexpected Home control value')
        if domain=='cover':
            if state.state in ('opening','closing') and features&8:service='stop_cover'
            elif state.state!='closed':
                if not features&2:raise ValueError('Cover cannot close')
                service='close_cover'
            else:
                if not features&1:raise ValueError('Cover cannot open')
                service='open_cover'
        elif domain=='fan':service='toggle'
        elif domain=='climate':
            service='turn_on' if state.state=='off' else 'turn_off'
            if not features&(256 if service=='turn_on' else 128):raise ValueError('Climate power unavailable')
        else:raise ValueError('Unsupported Home control')
    elif action=='home_adjust':
        if type(value) not in (int,float) or not math.isfinite(value) or not 0<=value<=100:raise ValueError('Use a finite control value between 0 and 100')
        info=model({'entity_id':entity_id},{'state':state.state,**card_metadata(state)})['popup']
        if not info['adjust']:raise ValueError('Target does not support this adjustment')
        service,field={'light':('turn_on','brightness_pct'),'cover':('set_cover_position','position'),
            'fan':('set_percentage','percentage'),'media_player':('volume_set','volume_level'),
            'climate':('set_temperature','temperature')}[domain]
        if domain=='climate':
            amount=info['minimum']+(info['maximum']-info['minimum'])*value/100
            amount=math.floor(amount/info['step']+.5)*info['step']
            data[field]=max(info['minimum'],min(info['maximum'],round(amount,3)))
        else:data[field]=value/100 if domain=='media_player' else round(value)
    else:raise ValueError('Unknown Home action')
    await hass.services.async_call(domain,service,data,blocking=True)
