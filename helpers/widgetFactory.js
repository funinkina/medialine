import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import St from 'gi://St';

import { PROGRESS_HEIGHT, PROGRESS_THUMB_SIZE } from './constants.js';

export function makeButton(styles, iconName, iconSize) {
    const btn = new St.Button({
        can_focus: true,
        track_hover: true,
        reactive: true,
        style_class: 'medialine-control-button',
        style: styles.btn,
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
    });
    const icon = new St.Icon({
        icon_name: iconName,
        icon_size: iconSize,
        style: styles.iconColor,
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
    });
    btn.set_child(icon);
    btn._active = false;
    return btn;
}

export function buildProgressWidgets(styles) {
    const timeCurrent = new St.Label({ text: '0:00', style: styles.time });
    const timeTotal = new St.Label({
        text: '0:00',
        style: styles.time,
        x_expand: true,
        x_align: Clutter.ActorAlign.END,
    });
    timeTotal.clutter_text.ellipsize = Pango.EllipsizeMode.END;

    const timeRow = new St.BoxLayout({ x_expand: true });
    timeRow.add_child(timeCurrent);
    timeRow.add_child(timeTotal);

    const progressTrack = new St.Widget({
        x_expand: true,
        y_align: Clutter.ActorAlign.CENTER,
        reactive: true,
        track_hover: true,
        style: styles.progressTrack,
        height: PROGRESS_HEIGHT,
    });
    const progressFill = new St.Widget({
        style: styles.progressFill,
        width: 0,
        height: PROGRESS_HEIGHT,
    });
    progressFill.set_position(0, 0);
    const progressThumb = new St.Widget({
        style: styles.progressThumb,
        width: PROGRESS_THUMB_SIZE,
        height: PROGRESS_THUMB_SIZE,
        visible: false,
    });
    progressThumb.set_position(
        -PROGRESS_THUMB_SIZE / 2,
        (PROGRESS_HEIGHT - PROGRESS_THUMB_SIZE) / 2);
    progressTrack.add_child(progressFill);
    progressTrack.add_child(progressThumb);

    return { timeCurrent, timeTotal, timeRow, progressTrack, progressFill, progressThumb };
}
