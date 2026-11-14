use serde::{Deserialize, Serialize};
use std::fs::OpenOptions;
use std::io::Write;

// ESC/POS Control Sequences
const ESC_INIT: [u8; 2] = [0x1B, 0x40];
const ESC_ALIGN_CENTER: [u8; 3] = [0x1B, 0x61, 0x01];
const ESC_ALIGN_LEFT: [u8; 3] = [0x1B, 0x61, 0x00];
const ESC_BOLD_ON: [u8; 3] = [0x1B, 0x45, 0x01];
const ESC_BOLD_OFF: [u8; 3] = [0x1B, 0x45, 0x00];
// Full paper cut with feed (GS V A 16)
const GS_CUT_FULL: [u8; 4] = [0x1D, 0x56, 0x41, 0x10];
// RJ11 Cash Drawer Kick on Pin 2: ESC p 0 25 250 -> [0x1B, 0x70, 0x00, 0x19, 0xFA]
const ESC_DRAWER_KICK_PIN2: [u8; 5] = [0x1B, 0x70, 0x00, 25, 250];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReceiptLineItem {
    pub name: String,
    pub qty: u32,
    pub unit_price: f64,
    pub line_total: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThermalReceiptInput {
    pub receipt_number: String,
    pub date_time: String,
    pub cashier_name: String,
    pub paper_width: String, // "80mm" or "58mm"
    pub items: Vec<ReceiptLineItem>,
    pub total_amount: f64,
    pub payment_method: String,
    pub change_given: f64,
    pub open_cash_drawer: bool,
    pub printer_port: Option<String>, // e.g., "USB001", "COM3", "/dev/usb/lp0"
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ZReportPrintInput {
    pub shift_id: String,
    pub cashier_name: String,
    pub opened_at: String,
    pub closed_at: String,
    pub paper_width: String, // "80mm" or "58mm"
    pub starting_cash: f64,
    pub total_cash_sales: f64,
    pub total_card_sales: f64,
    pub total_returns: f64,
    pub expected_cash: f64,
    pub actual_end_cash: f64,
    pub discrepancy: f64,
    pub printer_port: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EscPosCommandOutput {
    pub paper_width: String,
    pub drawer_triggered: bool,
    pub raw_bytes: Vec<u8>,
    pub hex_payload: String,
    pub printable_preview: String,
    pub transmitted_to_port: Option<String>,
}

fn encode_code128_barcode(data: &str) -> Vec<u8> {
    // GS k m n d1..dn (CODE128 = 73)
    let mut cmd = vec![0x1D, 0x6B, 73, data.len() as u8];
    cmd.extend_from_slice(data.as_bytes());
    cmd
}

fn send_to_port_if_configured(port: &Option<String>, bytes: &[u8]) -> Result<Option<String>, String> {
    if let Some(ref port_path) = port {
        if !port_path.trim().is_empty() {
            if let Ok(mut file) = OpenOptions::new().write(true).open(port_path) {
                file.write_all(bytes).map_err(|e| e.to_string())?;
                return Ok(Some(port_path.clone()));
            }
        }
    }
    Ok(None)
}

pub fn build_receipt_escpos(input: &ThermalReceiptInput) -> EscPosCommandOutput {
    let cols = if input.paper_width == "58mm" { 32 } else { 48 };
    let divider = "-".repeat(cols);

    let mut preview = String::new();
    preview.push_str("Alamir Market - ماركت الأمير\n");
    preview.push_str(&format!("Date/Time: {}\n", input.date_time));
    preview.push_str(&format!("Receipt #: {}\n", input.receipt_number));
    preview.push_str(&format!("Cashier  : {}\n", input.cashier_name));
    preview.push_str(&format!("{}\n", divider));

    for item in &input.items {
        preview.push_str(&format!(
            "{} | {} x {:.2} = {:.2} ج.م\n",
            item.name, item.qty, item.unit_price, item.line_total
        ));
    }

    preview.push_str(&format!("{}\n", divider));
    preview.push_str(&format!("TOTAL   : {:.2} ج.م\n", input.total_amount));
    preview.push_str(&format!("PAYMENT : {}\n", input.payment_method));
    preview.push_str(&format!("CHANGE  : {:.2} ج.م\n", input.change_given));
    preview.push_str(&format!("{}\n", divider));
    preview.push_str(&format!("BARCODE/QR: {}\n", input.receipt_number));

    let mut raw: Vec<u8> = Vec::new();
    raw.extend_from_slice(&ESC_INIT);
    if input.open_cash_drawer {
        raw.extend_from_slice(&ESC_DRAWER_KICK_PIN2);
    }
    raw.extend_from_slice(&ESC_ALIGN_CENTER);
    raw.extend_from_slice(&ESC_BOLD_ON);
    raw.extend_from_slice(b"Alamir Market\n");
    raw.extend_from_slice(&ESC_BOLD_OFF);
    raw.extend_from_slice(&ESC_ALIGN_LEFT);
    raw.extend_from_slice(preview.as_bytes());
    raw.extend_from_slice(&ESC_ALIGN_CENTER);
    raw.extend_from_slice(&encode_code128_barcode(&input.receipt_number));
    raw.push(b'\n');
    raw.extend_from_slice(&GS_CUT_FULL);

    let hex_payload = raw.iter().map(|b| format!("{:02x}", b)).collect::<String>();
    let transmitted = send_to_port_if_configured(&input.printer_port, &raw).ok().flatten();

    EscPosCommandOutput {
        paper_width: input.paper_width.clone(),
        drawer_triggered: input.open_cash_drawer,
        raw_bytes: raw,
        hex_payload,
        printable_preview: preview,
        transmitted_to_port: transmitted,
    }
}

pub fn build_z_report_escpos(input: &ZReportPrintInput) -> EscPosCommandOutput {
    let cols = if input.paper_width == "58mm" { 32 } else { 48 };
    let divider = "=".repeat(cols);

    let mut preview = String::new();
    preview.push_str("Alamir Market - ماركت الأمير\n");
    preview.push_str("END-OF-DAY SHIFT SUMMARY (Z-REPORT)\n");
    preview.push_str(&format!("{}\n", divider));
    preview.push_str(&format!("Shift ID     : {}\n", input.shift_id));
    preview.push_str(&format!("Cashier      : {}\n", input.cashier_name));
    preview.push_str(&format!("Opened At    : {}\n", input.opened_at));
    preview.push_str(&format!("Closed At    : {}\n", input.closed_at));
    preview.push_str(&format!("{}\n", divider));
    preview.push_str(&format!("Starting Cash: {:.2} ج.م\n", input.starting_cash));
    preview.push_str(&format!("Cash Sales   : {:.2} ج.م\n", input.total_cash_sales));
    preview.push_str(&format!("Card Sales   : {:.2} ج.م\n", input.total_card_sales));
    preview.push_str(&format!("Returns      : {:.2} ج.م\n", input.total_returns));
    preview.push_str(&format!("{}\n", divider));
    preview.push_str(&format!("Expected Cash: {:.2} ج.م\n", input.expected_cash));
    preview.push_str(&format!("Actual Cash  : {:.2} ج.م\n", input.actual_end_cash));
    preview.push_str(&format!("Discrepancy  : {:.2} ج.م\n", input.discrepancy));
    preview.push_str(&format!("{}\n", divider));

    let mut raw: Vec<u8> = Vec::new();
    raw.extend_from_slice(&ESC_INIT);
    raw.extend_from_slice(&ESC_ALIGN_CENTER);
    raw.extend_from_slice(&ESC_BOLD_ON);
    raw.extend_from_slice(preview.as_bytes());
    raw.extend_from_slice(&ESC_BOLD_OFF);
    raw.extend_from_slice(&GS_CUT_FULL);

    let hex_payload = raw.iter().map(|b| format!("{:02x}", b)).collect::<String>();
    let transmitted = send_to_port_if_configured(&input.printer_port, &raw).ok().flatten();

    EscPosCommandOutput {
        paper_width: input.paper_width.clone(),
        drawer_triggered: false,
        raw_bytes: raw,
        hex_payload,
        printable_preview: preview,
        transmitted_to_port: transmitted,
    }
}

#[tauri::command]
pub fn print_thermal_receipt(input: ThermalReceiptInput) -> Result<EscPosCommandOutput, String> {
    Ok(build_receipt_escpos(&input))
}

#[tauri::command]
pub fn print_z_report(input: ZReportPrintInput) -> Result<EscPosCommandOutput, String> {
    Ok(build_z_report_escpos(&input))
}

#[tauri::command]
pub fn trigger_cash_drawer(printer_port: Option<String>) -> Result<EscPosCommandOutput, String> {
    let mut raw = Vec::new();
    raw.extend_from_slice(&ESC_INIT);
    raw.extend_from_slice(&ESC_DRAWER_KICK_PIN2);
    let hex_payload = raw.iter().map(|b| format!("{:02x}", b)).collect::<String>();
    let transmitted = send_to_port_if_configured(&printer_port, &raw)?;

    Ok(EscPosCommandOutput {
        paper_width: "80mm".to_string(),
        drawer_triggered: true,
        raw_bytes: raw,
        hex_payload,
        printable_preview: "RJ11 Cash Drawer Kick (ESC p 0 25 250)".to_string(),
        transmitted_to_port: transmitted,
    })
}

