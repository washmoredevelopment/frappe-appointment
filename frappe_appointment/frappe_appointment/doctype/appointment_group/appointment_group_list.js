frappe.listview_settings["Appointment Group"] = {
  onload: function (listview) {
    const user = frappe.session.user;
    listview.page.add_button(__("Filter My Groups"), function () {
      listview.filter_area.add([["Members", "user", "=", user]]);
      frappe.show_alert({
        message: __("Filtering by {0} in member list", [user]),
        indicator: "green",
      });
    });

    // Add row actions
    listview.page.add_actions_menu_item(__("Copy Booking Link"), function () {
      const selectedItems = listview.get_checked_items();
      if (selectedItems.length === 0) {
        frappe.msgprint(__("Please select at least one Appointment Group"));
        return;
      }
      if (selectedItems.length === 1) {
        const bookingLink = get_booking_link(selectedItems[0].name);
        copy_to_clipboard(bookingLink);
      } else {
        // For multiple selections, show a dialog with all links
        const links = selectedItems.map((item) => ({
          name: item.group_name || item.name,
          link: get_booking_link(item.name),
        }));
        show_booking_links_dialog(links);
      }
    });

    listview.page.add_actions_menu_item(__("Open Booking Page"), function () {
      const selectedItems = listview.get_checked_items();
      if (selectedItems.length === 0) {
        frappe.msgprint(__("Please select an Appointment Group"));
        return;
      }
      if (selectedItems.length > 1) {
        frappe.msgprint(__("Please select only one Appointment Group"));
        return;
      }
      const bookingLink = get_booking_link(selectedItems[0].name);
      window.open(bookingLink, "_blank");
    });
  },

  button: {
    show: function (doc) {
      return true;
    },
    get_label: function () {
      return __("Copy Link");
    },
    get_description: function (doc) {
      return __("Copy booking link for {0}", [doc.group_name || doc.name]);
    },
    action: function (doc) {
      const bookingLink = get_booking_link(doc.name);
      copy_to_clipboard(bookingLink);
    },
  },
};

function get_booking_link(appointmentGroupName) {
  return frappe.urllib.get_full_url("/schedule/gr/" + encodeURIComponent(appointmentGroupName));
}

function copy_to_clipboard(text) {
  if (!navigator.clipboard) {
    frappe.msgprint(__("Clipboard API not supported. Please copy the value manually: {0}", [text]));
    return;
  }
  navigator.clipboard.writeText(text).then(() => {
    frappe.show_alert({
      message: __("Booking link copied to clipboard"),
      indicator: "green",
    });
  });
}

function show_booking_links_dialog(links) {
  let html = "<ul style='list-style: none; padding: 0;'>";
  links.forEach((item) => {
    html += `<li style='margin-bottom: 10px; display: flex; align-items: center; gap: 10px;'>
      <strong>${item.name}</strong>
      <button class='btn btn-xs btn-default' onclick="navigator.clipboard.writeText('${item.link}').then(() => frappe.show_alert({message: __('Copied!'), indicator: 'green'}))">
        ${__("Copy")}
      </button>
    </li>`;
  });
  html += "</ul>";

  const dialog = new frappe.ui.Dialog({
    title: __("Booking Links"),
    fields: [
      {
        fieldname: "links_html",
        fieldtype: "HTML",
      },
    ],
  });

  dialog.fields_dict.links_html.$wrapper.html(html);
  dialog.show();
}
